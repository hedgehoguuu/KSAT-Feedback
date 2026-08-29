-- ============================================================================
-- 0003 — 하루 접수 상한 (OPS-1 확장)
--
-- 기존 capacity 는 '통틀어 몇 건' 이고, 여기서 더하는 daily_capacity 는 '하루 몇 건' 이다.
-- 둘 다 살아 있고 둘 중 하나라도 차면 접수가 닫힌다.
--
-- 하루의 기준은 한국 날짜다. 접수번호가 이미 한국 날짜로 001 부터 다시 세고 있으므로
-- (receipt_counters) 같은 기준을 쓴다. 자정이 지나면 저절로 다시 열린다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- ------------------------------------------------------- 1. 설정 칸 추가
alter table app_settings
  add column if not exists daily_capacity integer;

alter table app_settings
  add column if not exists daily_closed_reason text
  not null default '오늘 접수는 다 찼어요. 내일 다시 열려요.';

-- 하루 100건으로 시작한다. 나중에 Table Editor 에서 숫자만 고치면 즉시 반영된다.
-- 비우면(null) 하루 상한이 없어진다.
update app_settings set daily_capacity = 100 where id = 1;

-- --------------------------------------------- 2. 제출할 때 실제로 막는다
-- 화면에서만 막으면 새는 구멍이 있다. 접수 스위치는 브라우저가 세션당 한 번 읽으므로,
-- 99번째와 100번째가 동시에 들어오면 둘 다 '열림' 을 보고 통과해 101건이 된다.
-- 그래서 접수를 만드는 트랜잭션 안에서 다시 센다.
--
-- next_receipt_no() 가 카운터 행을 원자적으로 올리고 잠그므로, 동시에 들어와도
-- 번호를 받는 순서가 하나로 정해진다. 상한을 넘긴 쪽은 예외로 통째로 되돌린다
-- (번호도 같이 되돌아가므로 다음 사람이 그 번호를 이어받는다).
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
    insert into submission_subjects (submission_id, subject_code, concerns, page_count)
    values (
      new_id,
      subj->>'subject_code',
      coalesce(subj->'concerns', '{}'::jsonb),
      coalesce(jsonb_array_length(subj->'files'), 0)
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

-- --------------------------------- 3. 오늘 몇 건 받았는지 (설치 점검·상태 표시용)
-- receipt_counters 는 발급한 번호를 세므로, 테스트 접수를 지워도 줄지 않는다.
-- 상한은 '오늘 몇 명을 받아줬나' 를 세는 것이므로 이게 맞다.
create or replace function today_receipt_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select seq from receipt_counters where day = (now() at time zone 'Asia/Seoul')::date),
    0
  );
$$;

-- ------------------------------------------------- 4. 설치 점검에 상한 노출
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
    'today_count', today_receipt_count()
  );
$$;
