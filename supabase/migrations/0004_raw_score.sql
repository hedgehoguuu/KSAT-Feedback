-- ============================================================================
-- 0004 — 과목 원점수 (2026-08-30)
--
-- 전 과목 공통으로 "이번 9월 모의평가 과목 원점수" 를 받는다.
-- 등급이 아니라 원점수인 이유는, 튜터가 시험지를 볼 때 몇 점짜리를 틀렸는지
-- 맞춰봐야 하기 때문이다.
--
-- 선택 입력이라 비어 있을 수 있다 (채점 전에 접수하는 학생이 있다).
-- 만점은 과목마다 다르고(국·수·영 100, 통합과학·통합사회 50) 그 검사는 앱에서 한다.
-- 여기서는 음수와 200 초과만 막는다 — 만점이 바뀌어도 DB 를 다시 고치지 않도록.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- ------------------------------------------------------------- 1. 칸 추가
alter table submission_subjects
  add column if not exists raw_score smallint;

do $$
begin
  alter table submission_subjects
    add constraint submission_subjects_raw_score_range
    check (raw_score is null or (raw_score >= 0 and raw_score <= 200));
exception
  when duplicate_object then null;   -- 이미 걸려 있으면 넘어간다
end $$;

-- --------------------------------------------- 2. 접수할 때 원점수도 함께 저장
-- 0003 에서 만든 하루 상한 검사를 그대로 두고 raw_score 만 더한다.
create or replace function create_submission(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing   text;
  new_no     text;
  new_id     uuid;
  subj       jsonb;
  subj_id    uuid;
  f          jsonb;
  cap        integer;
  used       integer;
begin
  -- 같은 제출을 두 번 눌렀으면 이미 만든 접수번호를 그대로 돌려준다.
  -- 상한 확인보다 먼저다 — 이미 받아준 접수를 재시도했다고 막으면 안 된다.
  select receipt_no into existing
    from submissions
   where idempotency_key = payload->>'idempotency_key';
  if existing is not null then
    return existing;
  end if;

  new_no := next_receipt_no();

  -- 오늘 몇 번째인지는 방금 올린 카운터가 알고 있다 (이 트랜잭션이 그 행을 잡고 있다)
  select daily_capacity into cap from app_settings where id = 1;
  if cap is not null and cap > 0 then
    select seq into used
      from receipt_counters
     where day = (now() at time zone 'Asia/Seoul')::date;

    if used > cap then
      raise exception 'DAILY_CAPACITY_REACHED'
        using errcode = 'P0001',
              hint = '하루 상한 ' || cap || '건을 넘었어요';
    end if;
  end if;

  insert into submissions (receipt_no, exam_code, grade, email, consent_at, purge_after, idempotency_key)
  values (
    new_no,
    payload->>'exam_code',
    (payload->>'grade')::smallint,
    payload->>'email',
    (payload->>'consent_at')::timestamptz,
    (payload->>'purge_after')::date,
    payload->>'idempotency_key'
  )
  returning id into new_id;

  for subj in select * from jsonb_array_elements(payload->'subjects')
  loop
    insert into submission_subjects (submission_id, subject_code, concerns, page_count, raw_score)
    values (
      new_id,
      subj->>'subject_code',
      coalesce(subj->'concerns', '{}'::jsonb),
      coalesce(jsonb_array_length(subj->'files'), 0),
      -- 'null' 이거나 칸이 아예 없으면 비워 둔다
      nullif(subj->>'raw_score', '')::smallint
    )
    returning id into subj_id;

    for f in select * from jsonb_array_elements(coalesce(subj->'files', '[]'::jsonb))
    loop
      insert into submission_files (subject_id, storage_path, order_index, bytes)
      values (subj_id, f->>'storage_path', (f->>'order_index')::int, (f->>'bytes')::int);
    end loop;
  end loop;

  return new_no;
end;
$$;

-- ---------------------------------------- 3. 설치 점검에 원점수 칸 노출
-- 이 SQL 을 안 돌렸으면 /setup 에서 빨갛게 뜨도록 한다.
create or replace function setup_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tables', (
      to_regclass('public.submissions')         is not null and
      to_regclass('public.submission_subjects') is not null and
      to_regclass('public.submission_files')    is not null
    ),
    'settings_row', (select count(*) > 0 from app_settings where id = 1),
    'functions', (
      to_regprocedure('public.create_submission(jsonb)') is not null and
      to_regprocedure('public.next_receipt_no(timestamptz)') is not null
    ),
    'worker_schema', (
      to_regclass('public.sync_failures') is not null and
      to_regprocedure('public.claim_submission(text)') is not null
    ),
    'bucket', (select count(*) > 0 from storage.buckets where id = 'exam-papers' and public = false),
    'submission_count', (select count(*) from submissions),
    'pending_count', (select count(*) from submissions where status in ('submitted','processing','failed')),
    'failure_count', (select count(*) from sync_failures where not resolved),
    'daily_capacity', (select daily_capacity from app_settings where id = 1),
    'today_count', today_receipt_count(),
    'raw_score', (
      select count(*) > 0 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'submission_subjects'
         and column_name = 'raw_score'
    )
  );
$$;
