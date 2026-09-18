-- ============================================================================
-- 0017 — 오래 열어 둔 채점 화면을 '시각' 이 아니라 '내용' 으로 알아본다
--
-- 0016 은 채점 화면이 본 판을 응시의 updated_at 으로 견줬다(rev). 그 값은 채점과 상관없는
-- 일에도 오른다 — 학생이 질문을 제출할 때마다(save_concerns). 그러면 튜터가 매기는 사이
-- 학생이 제출만 해도 저장이 거절되고, 매긴 것을 버리고 새로 고치는 수밖에 없었다.
-- 반대로 정답표를 고쳐 다시 매겨도(save_answer_key) updated_at 은 안 올라서, 그 전에 열어 둔
-- 화면으로 저장하면 옛 O/X 가 새 채점을 덮었다.
--
-- 그래서 화면이 그릴 때 본 정오와 정답표(base)를 통째로 받아, 응시를 잠근 뒤 지금 것과 견준다.
-- 답변 PDF 를 보낼 때 이미 쓰는 방식(mark_feedback_ready 의 REGRADED)과 같다.
--   · 학생 질문 제출 · 메일 기록 · 공개 표시 같은 것에는 반응하지 않는다.
--   · 사진이 바뀌어 사진 채점이 비워지거나 새로 채워진 것, 정답표가 고쳐진 것에는 반응한다.
--
-- 0016 뒤에 고친 정답표 저장의 잠금 순서(응시를 먼저, id 순으로)도 여기에 다시 싣는다.
-- 0016 을 그 전에 돌린 DB 도 이 파일 하나로 맞춰진다.
--
-- 이 파일부터는 끝에 schema_migrations 에 이름을 적는다. /setup 이 그 표를 보고 빠진 파일을
-- 짚는다 — 함수가 '있는지' 만 봐서는 옛 판인지 새 판인지 모른다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 지금 돌고 있는 앱(rev 를 보내는 0016 판)과도 맞는다 — 먼저 돌리고 배포한다.
-- ============================================================================

-- -------------------------------------------------- 1. 채점 판 (지금 · 화면이 본 것)
-- 정오는 문항 id 순으로, 정답표도 문항 id 순으로. 양쪽을 같은 모양으로 만들어야 견줄 수 있다.
create or replace function lms_grading_snapshot(aid uuid, eid uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', question_id, 'correct', correct, 'chosen', chosen)
                       order by question_id)
        from lms_answers
       where attempt_id = aid), '[]'::jsonb),
    'key', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', id, 'answer', answer) order by id)
        from lms_exam_questions
       where exam_id = eid), '[]'::jsonb)
  );
$$;

-- 화면이 보낸 판을 위와 같은 모양으로. 빈 값('')은 없음(null)으로 본다.
create or replace function lms_grading_shape(base jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', (x->>'question_id')::uuid,
                                          'correct', (x->>'correct')::boolean,
                                          'chosen', nullif(x->>'chosen', '')::smallint)
                       order by (x->>'question_id')::uuid)
        from jsonb_array_elements(coalesce(base->'answers', '[]'::jsonb)) as x), '[]'::jsonb),
    'key', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', (x->>'question_id')::uuid,
                                          'answer', nullif(x->>'answer', '')::smallint)
                       order by (x->>'question_id')::uuid)
        from jsonb_array_elements(coalesce(base->'key', '[]'::jsonb)) as x), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------- 2. 채점 저장
-- 0016 과 같고, 견주는 것만 바뀐다.
--   · base — 화면이 그릴 때 본 정오와 정답표. 응시를 잠근 뒤 지금 것과 다르면 STALE 로 멈추고
--     아무것도 쓰지 않는다. 정답표를 고치는 save_answer_key 도 이 응시 행을 먼저 잠그므로,
--     잠금을 쥔 동안 읽은 정답표는 끝날 때까지 그대로다.
--   · base 가 없고 rev 만 오면(0016 판의 앱) 예전처럼 updated_at 으로 견준다.
--   · 둘 다 없으면(0015 판의 앱) 견주지 않는다.
create or replace function save_grading(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid      uuid  := (payload->>'attempt_id')::uuid;
  base     jsonb := payload->'base';
  rev      text  := nullif(payload->>'rev', '');
  eid      uuid;
  seen     timestamptz;
  wanted   int   := jsonb_array_length(coalesce(payload->'answers', '[]'::jsonb));
  inserted int;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  select exam_id, updated_at into eid, seen from lms_attempts where id = aid for update;
  if eid is null then
    raise exception '없는 응시입니다: %', aid;
  end if;

  if jsonb_typeof(base) = 'object' then
    if lms_grading_snapshot(aid, eid) is distinct from lms_grading_shape(base) then
      raise exception 'STALE' using errcode = 'P0001', hint = '그사이 이 응시의 채점이나 정답표가 바뀌었어요';
    end if;
  elsif rev is not null and seen is distinct from rev::timestamptz then
    raise exception 'STALE' using errcode = 'P0001', hint = '그사이 이 응시의 채점이 바뀌었어요';
  end if;

  delete from lms_answers where attempt_id = aid;

  insert into lms_answers (attempt_id, question_id, correct, chosen)
  select aid,
         q.id,
         (a->>'correct')::boolean,
         nullif(a->>'chosen', '')::smallint
    from jsonb_array_elements(coalesce(payload->'answers', '[]'::jsonb)) a
    join lms_exam_questions q
      on q.id = (a->>'question_id')::uuid
     and q.exam_id = eid;

  get diagnostics inserted = row_count;
  if inserted <> wanted then
    raise exception '이 회차의 문항이 아닌 것이 섞여 있습니다 (% 중 %)', wanted, inserted;
  end if;

  update lms_attempts
     set overall_comment = payload->>'overall_comment',
         status          = coalesce(payload->>'status', status),
         answers_source  = case when inserted > 0 then 'tutor' end,
         updated_at      = now()
   where id = aid;
end;
$$;

-- -------------------------------------------------------- 3. 정답표 저장
-- 0016 의 마지막 판 그대로다 (응시를 먼저 잠그는 순서). 0016 을 그 전에 돌린 DB 를 맞추려고 다시 싣는다.
-- 0015 와 견주면 끝에 한 가지가 더 있다: 사진으로 채운 채점은 읽어 둔 답으로 다시 채운다.
-- 정답이 비어 있던 문항은 아래의 '다시 매기기' 로는 정오가 안 생긴다 — 줄이 아예 없었으니까.
create or replace function save_answer_key(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  eid        uuid := (payload->>'exam_id')::uuid;
  r          jsonb;
  qno        smallint;
  qid        uuid;
  old_answer smallint;
  new_answer smallint;
  changed    smallint[] := '{}';
  regraded   integer := 0;
  -- 없던 줄을 정답과 함께 새로 깐 경우. changed 에는 안 잡히지만 사진 채점은 다시 채워야 한다.
  keyed_new  boolean := false;
  aid        uuid;
begin
  if eid is null then
    raise exception 'exam_id 가 없습니다';
  end if;

  perform 1 from lms_exams where id = eid for update;
  if not found then
    raise exception '없는 회차입니다: %', eid;
  end if;

  -- 답안 행을 건드리기 전에 이 회차의 응시를 id 순으로 먼저 잠근다.
  -- 사진 변경 트리거(0016 의 4번)는 응시 → 답안 순으로 잠근다. 여기서 답안을 먼저 잠그면(아래 다시
  -- 매기기) 서로 상대가 쥔 잠금을 기다리다 한쪽이 죽는다 — 정답표 저장이나 학생 사진
  -- 올리기가 실패한다. 이 회차의 응시 수는 한 반이라 잠깐이다.
  -- 채점 저장(save_grading)도 응시 행을 먼저 잠그고 정답표를 읽는다. 그래서 둘이 겹치면 한쪽이
  -- 끝날 때까지 기다리고, 늦게 온 채점 저장은 바뀐 정답표를 보고 STALE 로 멈춘다.
  perform 1 from lms_attempts where exam_id = eid order by id for update;

  for r in select * from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  loop
    qno        := (r->>'no')::smallint;
    new_answer := nullif(r->>'answer', '')::smallint;

    select id, answer into qid, old_answer
      from lms_exam_questions
     where exam_id = eid and no = qno;

    if qid is null then
      insert into lms_exam_questions (exam_id, no, points, answer, unit_code)
      values (eid, qno, (r->>'points')::numeric, new_answer, nullif(r->>'unit_code', ''));
      keyed_new := keyed_new or new_answer is not null;
    else
      update lms_exam_questions
         set points    = (r->>'points')::numeric,
             answer    = new_answer,
             unit_code = nullif(r->>'unit_code', '')
       where id = qid;
      if new_answer is distinct from old_answer then
        changed := changed || qno;
      end if;
    end if;
  end loop;

  if cardinality(changed) > 0 then
    update lms_answers a
       set correct = (a.chosen = q.answer)
      from lms_exam_questions q
     where q.id = a.question_id
       and q.exam_id = eid
       and q.no = any(changed)
       and a.chosen is not null
       and q.answer is not null;
    get diagnostics regraded = row_count;
  end if;

  if cardinality(changed) > 0 or keyed_new then
    for aid in
      select a.id
        from lms_attempts a
        join lms_photo_reads pr on pr.attempt_id = a.id and pr.status = 'done'
       where a.exam_id = eid
         and a.status = 'draft'
         and a.answers_source is distinct from 'tutor'
       order by a.id
         for update of a
    loop
      perform apply_photo_read_locked(aid, false);
    end loop;
  end if;

  return regraded;
end;
$$;


-- ----------------------------------------------------- 4. 서버 전용 함수 잠금
-- 0014 · 0015 · 0016 과 같은 이유. 다시 만든 함수도, 새 안쪽 함수도 공개 키로는 못 부르게 한다.
do $$
declare
  fn text;
begin
  foreach fn in array array['save_grading(jsonb)', 'save_answer_key(jsonb)']
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;

  foreach fn in array array['lms_grading_snapshot(uuid, uuid)', 'lms_grading_shape(jsonb)']
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------ 5. 돌린 파일 적어 두기
-- /setup 이 이 표를 읽어 빠진 마이그레이션을 짚는다 (lib/health.ts 의 REQUIRED_MIGRATIONS).
-- 이 파일부터 새 마이그레이션은 끝에 자기 이름을 한 줄 적는다. 이미 돌린 파일은 고치지 않는다 —
-- 고칠 것이 생기면 새 번호로 낸다. 그래야 '다시 돌려야 하는지' 를 사람이 기억하지 않아도 된다.
create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- 0008 과 같다. 앱은 service_role 로만 붙는다.
alter table schema_migrations enable row level security;

insert into schema_migrations (name) values ('0017_lms_grading_guard')
  on conflict (name) do update set applied_at = excluded.applied_at;
