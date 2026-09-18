-- ============================================================================
-- 0018 — 상태가 바뀌는 자리마다 DB 가 한 번 더 본다
--
-- 화면에서는 성공했는데 실제 결과가 어긋나던 자리들이다. 앱이 먼저 확인하더라도, 확인과 쓰기
-- 사이에 다른 요청이 끼어들 수 있는 것은 여기서 같은 잠금 안에서 다시 본다.
--
--   1. 비밀번호를 바꾸면 다른 기기의 로그인이 풀린다 (lms_users.session_key)
--   2. 실패한 접수는 곧바로 다시 집지 않는다 (claim_submission)
--   3. 취소한 신청을 되살릴 때도 정원과 같은 번호를 본다 (set_application_status)
--   4. 점수가 든 답변 PDF 는 공개 여부와 상관없이 판을 견준다 (mark_feedback_ready)
--   5. 답을 보낸 시험의 사진은 DB 가 막는다 (사진 트리거)
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 지금 돌고 있는 앱(0017 판)과도 맞는다 — 먼저 돌리고 배포한다.
-- ============================================================================

-- ------------------------------------------------ 1. 로그인 세션 열쇠
-- 비밀번호를 바꾸거나 새로 발급할 때마다 앱이 새로 뽑는다(lib/lms/users.ts). 로그인 쿠키에 같은
-- 값이 들어 있어서, 값이 바뀌면 그 전에 나간 쿠키가 전부 풀린다(lib/lms/auth.ts). 쿠키는 30일
-- 가므로, 이게 없으면 비밀번호를 바꿔도 잃어버린 기기의 로그인이 한 달 동안 산다.
-- 비어 있으면 '한 번도 안 뽑음' 이다 — 열쇠가 생기기 전의 쿠키가 그때까지만 통한다.
alter table lms_users add column if not exists session_key text;

-- ------------------------------------------- 2. 실패한 접수를 곧바로 다시 집지 않는다
-- 0002 와 같고 한 가지가 다르다: 실패한 접수는 마지막으로 집은 지 10분이 지나야 다시 집는다.
-- 예전에는 가장 오래된 실패를 곧바로 다시 줘서, 빨리 실패하는 접수 하나가 크론 한 판 안에서
-- 자동 재시도 다섯 번을 다 써 버렸다 — 바깥 서비스가 다음 날 살아나도 그 접수는 다시 돌지 않고,
-- 뒤에 밀린 새 접수는 그동안 기다렸다. 이제 크론 한 판에 한 번씩, 닷새에 걸쳐 다시 해 본다.
-- 사람이 번호를 집어 부르면(p_receipt_no) 기다리지 않는다.
create or replace function claim_submission(p_receipt_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_no text;
begin
  select id into v_id
    from submissions
   where (p_receipt_no is null or receipt_no = p_receipt_no)
     and process_attempts < 5
     and (
       status = 'submitted'
       or (status = 'failed'
           and (p_receipt_no is not null or claimed_at is null or claimed_at < now() - interval '10 minutes'))
       -- 처리 중 함수가 죽은 건은 10분 뒤 다시 집어온다
       or (status = 'processing' and claimed_at < now() - interval '10 minutes')
     )
   order by created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return null;
  end if;

  update submissions
     set status = 'processing',
         claimed_at = now(),
         process_attempts = process_attempts + 1
   where id = v_id
   returning receipt_no into v_no;

  return v_no;
end;
$$;

-- 0014 와 같은 이유. 다시 만든 함수도 공개 키로는 못 부르게 한다.
revoke execute on function public.claim_submission(text) from public, anon, authenticated;
grant execute on function public.claim_submission(text) to service_role;

-- -------------------------------------- 3. 취소한 신청을 되살릴 때도 정원을 본다
-- 새 신청은 반 행을 잠그고 정원을 보는데(create_class_application), 관리자의 상태 옮기기는 조건 없는
-- UPDATE 였다. 정원 3명인 반에서 A 를 취소하고 D 를 받은 뒤 A 를 '입금 완료' 로 되돌리면 넷이 된다.
-- 취소 → 살아 있는 상태로 옮길 때는 새 신청과 같은 반 잠금 아래에서 정원과 같은 연락처를 다시 본다.
-- 더 받으려면 /admin 에서 정원을 먼저 늘린다.
create or replace function set_application_status(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid   uuid := (payload->>'id')::uuid;
  want  text := payload->>'status';
  cid   uuid;
  cur   text;
  phone text;
  cap   int;
  taken int;
begin
  if aid is null or want is null then
    raise exception 'id 와 status 가 필요합니다';
  end if;

  select class_id into cid from class_applications where id = aid;
  if cid is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001', hint = '없는 신청이에요';
  end if;

  -- 새 신청과 같은 순서로 잠근다: 반 → 신청
  select capacity into cap from classes where id = cid for update;
  select status, parent_phone into cur, phone from class_applications where id = aid for update;

  if cur = 'canceled' and want <> 'canceled' then
    if exists (
      select 1 from class_applications
       where class_id = cid and parent_phone = phone and status <> 'canceled' and id <> aid
    ) then
      raise exception 'DUPLICATE' using errcode = 'P0001', hint = '같은 연락처의 살아 있는 신청이 있어요';
    end if;

    select count(*) into taken
      from class_applications
     where class_id = cid and status <> 'canceled';
    if taken >= cap then
      raise exception 'CLASS_FULL' using errcode = 'P0001', hint = '자리가 다 찼어요';
    end if;
  end if;

  update class_applications set status = want where id = aid;
end;
$$;

revoke execute on function public.set_application_status(jsonb) from public, anon, authenticated;
grant execute on function public.set_application_status(jsonb) to service_role;

-- ----------------------------------- 4. 점수가 든 답변 PDF 는 늘 판을 견준다
-- 0016 과 같고 견주는 조건만 바뀐다. 0016 은 '이번에 점수를 새로 여는가(publish)' 일 때만 정오를
-- 견줬다. 이미 공개한 응시에 PDF 를 (다시) 보내는 사이 채점이 바뀌면, 옛 점수가 든 PDF 가 나갔다.
-- 이제 앱이 PDF 를 만들 때 읽은 판(base — 정오와 정답표, 0017)을 늘 보내고, 여기서 지금 것과 견준다.
-- PDF 의 정오표에는 정답도 찍히므로 정답표까지 본다.
create or replace function mark_feedback_ready(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid          uuid := (payload->>'attempt_id')::uuid;
  publish      boolean := coalesce((payload->>'publish')::boolean, false);
  included     uuid[];
  now_ids      uuid[];
  now_answers  jsonb;
  sent_answers jsonb;
begin
  if aid is null or coalesce(payload->>'path', '') = '' then
    raise exception 'attempt_id 와 path 가 필요합니다';
  end if;

  perform 1 from lms_attempts where id = aid for update;
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;

  if exists (
    select 1 from lms_concerns
     where attempt_id = aid and answer is null and answer_image_path is null
  ) then
    raise exception 'UNANSWERED' using errcode = 'P0001', hint = '답이 안 달린 질문이 있어요';
  end if;

  select coalesce(array_agg(value::uuid), '{}')
    into included
    from jsonb_array_elements_text(coalesce(payload->'concern_ids', '[]'::jsonb));
  select coalesce(array_agg(id), '{}')
    into now_ids
    from lms_concerns
   where attempt_id = aid;

  if cardinality(now_ids) = 0 then
    raise exception 'NO_CONCERNS' using errcode = 'P0001', hint = '질문이 하나도 없어요';
  end if;
  if not (included @> now_ids and now_ids @> included) then
    raise exception 'CHANGED' using errcode = 'P0001', hint = '그사이 학생 질문이 바뀌었어요';
  end if;

  if jsonb_typeof(payload->'base') = 'object' then
    -- 점수가 든 PDF 다. 새로 공개하든 이미 공개했든, 만들 때 읽은 판(정오 · 정답표)이 지금도 같아야 한다.
    if lms_grading_snapshot(aid, (select exam_id from lms_attempts where id = aid))
       is distinct from lms_grading_shape(payload->'base') then
      raise exception 'REGRADED' using errcode = 'P0001', hint = '보내는 사이 채점이나 정답표가 바뀌었어요';
    end if;
  elsif publish then
    -- 0017 판의 앱은 base 대신 answers 를 보낸다 (새로 공개할 때만).
    -- 양쪽을 같은 모양으로 만들어 견준다 (문항 id 순서 · 같은 자료형).
    select coalesce(jsonb_agg(jsonb_build_object('question_id', question_id, 'correct', correct, 'chosen', chosen)
                              order by question_id), '[]'::jsonb)
      into now_answers
      from lms_answers
     where attempt_id = aid;
    select coalesce(jsonb_agg(jsonb_build_object('question_id', (x->>'question_id')::uuid,
                                                 'correct', (x->>'correct')::boolean,
                                                 'chosen', nullif(x->>'chosen', '')::smallint)
                              order by (x->>'question_id')::uuid), '[]'::jsonb)
      into sent_answers
      from jsonb_array_elements(coalesce(payload->'answers', '[]'::jsonb)) as x;
    if now_answers is distinct from sent_answers then
      raise exception 'REGRADED' using errcode = 'P0001', hint = '보내는 사이 채점이 바뀌었어요';
    end if;
  end if;

  update lms_attempts
     set feedback_path     = payload->>'path',
         feedback_ready_at = now(),
         status            = case when publish then 'published' else status end,
         updated_at        = now()
   where id = aid;
end;
$$;

-- -------------------------------------- 5. 답을 보낸 시험의 사진은 DB 가 막는다
-- 0016 과 같고 한 가지를 더한다: 답을 보낸 응시(feedback_ready_at)면 사진을 넣지도 지우지도 못한다.
-- 학생 쪽 서버 함수는 시작할 때 한 번 보는데, 저장소에 사진을 올리는 동안 튜터가 보내기를 끝내면
-- 그 확인은 낡는다. 응시를 잠그는 이 트리거에서 다시 본다.
create or replace function lms_photos_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aid        uuid := case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  att_status text;
  att_source text;
  att_ready  timestamptz;
begin
  select status, answers_source, feedback_ready_at into att_status, att_source, att_ready
    from lms_attempts
   where id = aid
     for update;
  -- 응시를 지우며 딸려 지워지는 사진이면 응시가 이미 없다. 할 일이 없다.
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- 답을 보낸 시험은 잠긴다. 앱도 먼저 보지만, 그 확인과 여기 사이에 튜터가 보내기를 끝낼 수 있다.
  -- 응시를 잠근 이 자리에서 다시 봐야 보낸 PDF 와 사진이 어긋나지 않는다.
  if att_ready is not null then
    raise exception 'LOCKED' using errcode = 'P0001', hint = '답을 이미 받은 시험이에요';
  end if;

  if att_status = 'draft' and att_source = 'photo' then
    delete from lms_answers where attempt_id = aid;
    update lms_attempts
       set answers_source = null,
           updated_at     = now()
     where id = aid;
  end if;

  -- 마지막 사진을 지우면 읽을 것이 없다. 읽기 기록을 빈 결과로 닫는다 — 실패나 멈춤으로 남으면
  -- 매일 새벽 정리가 사진 없는 응시를 되살리려고 자리를 차지한다. 번호를 올려 읽는 중이던 옛
  -- 읽기도 버리게 한다. 모델을 부른 횟수(runs)는 그대로 둔다 — 지웠다 다시 올려 상한을 풀지 못하게.
  if tg_op = 'DELETE'
     and not exists (select 1 from lms_attempt_photos where attempt_id = aid and id <> old.id) then
    update lms_photo_reads
       set request_no  = request_no + 1,
           status      = 'done',
           finished_at = now(),
           photo_ids   = '{}',
           answers     = '[]'::jsonb,
           unreadable  = '{}',
           note        = null,
           error       = null,
           updated_at  = now()
     where attempt_id = aid;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lms_photos_changed on lms_attempt_photos;
create trigger lms_photos_changed
  before insert or delete on lms_attempt_photos
  for each row execute function lms_photos_changed();

-- 0014 · 0016 과 같은 이유. 다시 만든 함수도 공개 키로는 못 부르게 한다.
revoke execute on function public.mark_feedback_ready(jsonb) from public, anon, authenticated;
grant execute on function public.mark_feedback_ready(jsonb) to service_role;
revoke execute on function public.lms_photos_changed() from public, anon, authenticated;

-- ------------------------------------------------------ 돌린 파일 적어 두기
-- /setup 이 이 표를 읽어 빠진 마이그레이션을 짚는다 (lib/health.ts 의 REQUIRED_MIGRATIONS).
-- 표는 0017 이 만든다. 0017 을 건너뛰고 돌려도 여기서 멈추지 않게 한 번 더 적는다.
create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;

insert into schema_migrations (name) values ('0018_state_guards')
  on conflict (name) do update set applied_at = excluded.applied_at;
