-- ============================================================================
-- 0020 — 채점은 선생님이 한다. 학생 사진은 질문용일 뿐이다
--
-- 0016 은 학생이 올린 시험지 사진에서 답을 읽어 채점을 채웠다. 그래서 학생이 사진을 바꿀
-- 때마다 사진으로 매긴 채점을 비우고, 다시 읽고, 늦게 끝난 읽기를 버리는 장치가 줄줄이 붙었다.
-- 이제 채점은 선생님이 수업에서 걷은 OMR 을 찍어 채점 화면에서 읽히고, 눈으로 확인한 뒤 저장한다
-- (앱이 읽기만 하고 저장하지 않는다 — 정답표 사진 읽기와 같다). 학생 사진은 질문에 답할 때 보는
-- 자료일 뿐 채점과 아무 상관이 없다.
--
-- 점수를 따로 '공개' 하는 단계도 없앤다. 수업이 끝나면 학생은 자기 점수를 이미 안다. 선생님이
-- 30문항을 다 매겨 저장했고 회차가 '학생에게 열림' 이면 학생 화면에 보인다 (앱의 scoreShown).
--
--   1. 사진 트리거 — 학생 사진이 바뀌어도 채점을 건드리지 않는다. 답을 보낸 시험의 사진을
--      막는 것(0018)만 남긴다.
--   2. 정답표 저장 — 사진 읽기 결과로 채점을 다시 채우던 끝부분을 뺀다.
--   3. 이미 공개한 사진 채점은 선생님 채점으로 본다 — 선생님이 보고 공개를 누른 것이다.
--
-- 쓰지 않게 된 것 — lms_photo_reads 표와 request · claim · finish · fail · apply_photo_read(_locked) ·
-- publish_grades · lms_photo_set_is 함수, lms_attempts.status 열 — 은 지우지 않는다. 이 SQL 을 먼저
-- 돌리고 배포하는 몇 분 동안 지금 돌고 있는 앱이 그것들을 부른다. 새 앱은 부르지 않는다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 지금 돌고 있는 앱(0019 판)과도 맞는다 — 먼저 돌리고 배포한다.
-- ============================================================================

-- ------------------------------------------------ 1. 사진 트리거는 잠금만
-- 0018 과 같고, 사진으로 매긴 채점을 비우는 부분과 읽기 기록을 닫는 부분을 뺐다.
-- 응시 행을 먼저 잠그는 것은 그대로다 — 보내기(mark_feedback_ready)와 같은 잠금을 기다려야
-- 그 사이에 튜터가 보내기를 끝냈는지 다시 볼 수 있다.
create or replace function lms_photos_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aid       uuid := case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  att_ready timestamptz;
begin
  select feedback_ready_at into att_ready
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
  if att_ready is not null then
    raise exception 'LOCKED' using errcode = 'P0001', hint = '답을 이미 받은 시험이에요';
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

-- -------------------------------------------------------- 2. 정답표 저장
-- 0017 과 같고, 끝의 '사진으로 채운 채점은 읽어 둔 답으로 다시 채운다' 를 뺐다.
-- 정답을 고친 문항은 적어 둔 학생 답으로 다시 매기는 것은 그대로다.
--
-- 응시를 먼저 id 순으로 잠그는 것도 그대로 둔다. 채점 저장(save_grading)이 응시 행을 잠근 채로
-- 정답표를 읽고 화면이 본 판과 견주므로, 둘이 겹치면 한쪽이 끝날 때까지 기다리고 늦게 온 채점
-- 저장은 바뀐 정답표를 보고 STALE 로 멈춘다.
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
begin
  if eid is null then
    raise exception 'exam_id 가 없습니다';
  end if;

  perform 1 from lms_exams where id = eid for update;
  if not found then
    raise exception '없는 회차입니다: %', eid;
  end if;

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

  return regraded;
end;
$$;

-- --------------------------------------- 3. 공개한 사진 채점은 선생님 채점으로
-- 새 앱은 '선생님이 매겨 저장한 채점(answers_source = tutor)이 30문항 다 찼는가' 로 학생에게
-- 보일지를 정한다. 0016 시절 사진으로 채우고 선생님이 확인 없이 공개한 채점도 공개는 선생님이
-- 누른 것이라 그대로 보이게 둔다. 공개하지 않은 사진 채점은 두고 — 선생님이 채점 화면에서
-- 확인하고 저장하면 그때 선생님 채점이 된다.
update lms_attempts
   set answers_source = 'tutor'
 where answers_source = 'photo'
   and status = 'published';

-- ----------------------------------------------------- 4. 서버 전용 함수 잠금
-- 0014 · 0016 · 0017 · 0018 과 같은 이유. 다시 만든 함수도 공개 키로는 못 부르게 한다.
revoke execute on function public.save_answer_key(jsonb) from public, anon, authenticated;
grant execute on function public.save_answer_key(jsonb) to service_role;
revoke execute on function public.lms_photos_changed() from public, anon, authenticated;

-- ------------------------------------------------------ 돌린 파일 적어 두기
-- /setup 이 이 표를 읽어 빠진 마이그레이션을 짚는다 (lib/health.ts 의 REQUIRED_MIGRATIONS).
create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;

insert into schema_migrations (name) values ('0020_lms_tutor_grading')
  on conflict (name) do update set applied_at = excluded.applied_at;
