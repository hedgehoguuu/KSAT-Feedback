-- ============================================================================
-- 0015 — 수학(미적분) 실전 모의고사 수업으로
--
-- 수업이 국어에서 수학으로 바뀌었고, 학생은 전부 미적분을 고른다. 달라지는 것은 셋이다.
--
--   1) 시험지 모양이 하나로 고정된다. 1–22 공통 · 23–30 미적분이고 배점도 번호마다
--      정해져 있다(src/config/lms.ts 의 PAPER). 그래서 회차마다 문항표를 짜지 않고
--      정답과, 원하면 단원만 넣는다. 단답형 정답은 0–999 라 정답·학생 답 칸이 넓어진다.
--   2) 선택과목(화작/언매) 칸과 국어 영역 코멘트가 사라진다.
--   3) 시험이 끝나면 학생이 시험지 사진과 문항별 질문을 올리고, 튜터가 답을 달아
--      PDF 로 보낸다. 사진 · 질문 표 둘과 응시 행의 칸 몇 개가 생긴다.
--
-- 국어 기록은 지우지 않는다. lms_legacy_* 표로 옮겨 두고(Table Editor 에서 그대로 보인다)
-- 수업 표에서만 뺀다. 국어 영역 코드가 붙은 45줄짜리 문항표가 수학 채점에 섞이면
-- 만점부터 점수까지 전부 거짓말이 된다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 한 번에 보낸 문장들은 한 트랜잭션으로 돌아서, 중간에 실패하면 아무것도 안 바뀐다.
-- ============================================================================

-- ---------------------------------------------------------- 1. 국어 기록 옮기기
-- 0015 전의 모양(area_code 열)이 남아 있을 때만 돈다. 그때 있던 회차는 전부 국어다 —
-- 이 앱이 국어만 받던 시절에 만들어졌다. 옮기고 나면 모양이 바뀌어 다시 돌지 않는다.
do $$
declare
  moved int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lms_exam_questions' and column_name = 'area_code'
  ) then
    return;
  end if;

  -- 외래키는 따라오지 않는다(like 는 안 베낀다). 보관용이라 그게 맞다 — 학생 계정을
  -- 지워도 옛 기록이 막지 않고, 옛 기록 때문에 새 표가 묶이지도 않는다.
  create table if not exists lms_legacy_exams          (like lms_exams          including all);
  create table if not exists lms_legacy_exam_questions (like lms_exam_questions including all);
  create table if not exists lms_legacy_attempts       (like lms_attempts       including all);
  create table if not exists lms_legacy_answers        (like lms_answers        including all);

  insert into lms_legacy_exams          select * from lms_exams          on conflict do nothing;
  insert into lms_legacy_exam_questions select * from lms_exam_questions on conflict do nothing;
  insert into lms_legacy_attempts       select * from lms_attempts       on conflict do nothing;
  insert into lms_legacy_answers        select * from lms_answers        on conflict do nothing;

  if to_regclass('public.lms_area_comments') is not null then
    create table if not exists lms_legacy_area_comments (like lms_area_comments including all);
    insert into lms_legacy_area_comments select * from lms_area_comments on conflict do nothing;
  end if;

  alter table lms_legacy_exams          enable row level security;
  alter table lms_legacy_exam_questions enable row level security;
  alter table lms_legacy_attempts       enable row level security;
  alter table lms_legacy_answers        enable row level security;
  if to_regclass('public.lms_legacy_area_comments') is not null then
    alter table lms_legacy_area_comments enable row level security;
  end if;

  select count(*) into moved from lms_exams;
  -- 회차를 지우면 문항표 · 응시 · 정오 · 코멘트가 따라 지워진다 (0008 의 on delete cascade).
  -- 반 · 수강 · 계정은 그대로다. 수학 수업을 같은 반에서 이어 간다.
  delete from lms_exams;

  raise notice '국어 회차 %개를 lms_legacy_* 표로 옮겼습니다. 반 · 학생 계정은 그대로예요.', moved;
end $$;

-- 학생마다 적어 둔 선택과목(화작/언매)도 같은 식으로 남겨 둔다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lms_students' and column_name = 'elective'
  ) then
    create table if not exists lms_legacy_student_electives (
      user_id  uuid primary key,
      elective text not null
    );
    alter table lms_legacy_student_electives enable row level security;
    insert into lms_legacy_student_electives (user_id, elective)
      select user_id, elective from lms_students where elective is not null
      on conflict (user_id) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------- 2. 선택과목 · 영역 코멘트
-- 선택과목은 미적분 하나뿐이라 고를 칸이 필요 없다. 값은 위에서 옮겼다.
alter table lms_attempts drop column if exists elective;
alter table lms_students drop column if exists elective;

-- 국어 영역 코멘트. 위에서 옮기고 비웠으니 빈 표여야 한다 — 아니면 멈춘다.
do $$
begin
  if to_regclass('public.lms_area_comments') is not null then
    if exists (select 1 from lms_area_comments) then
      raise exception '옮기지 못한 영역 코멘트가 남아 있습니다. lms_area_comments 를 확인해주세요.';
    end if;
    drop table lms_area_comments;
  end if;
end $$;

-- ---------------------------------------------------------------- 3. 문항표
-- 회차마다 1–30 번이 한 줄씩. 번호 하나가 곧 문항 하나다 — 국어처럼 같은 번호에
-- 두 벌(화작·언매)이 들어갈 일이 없어서 0010 의 (번호 + 영역) 열쇠를 번호로 되돌린다.
alter table lms_exam_questions drop constraint if exists lms_exam_questions_exam_no_area_key;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lms_exam_questions' and column_name = 'area_code'
  ) then
    alter table lms_exam_questions rename column area_code to unit_code;
  end if;
end $$;

-- 단원은 넣어도 되고 안 넣어도 된다. 정답표 사진에는 대개 없고, 없는 것을 짐작해
-- 채우면 단원별 정답률이 조용히 거짓말이 된다. 비워 두면 그 문항은 단원 집계에서만 빠진다.
alter table lms_exam_questions alter column unit_code drop not null;
-- 국어의 지문 표시 칸
alter table lms_exam_questions drop column if exists passage;

-- 1–30 번. 배점(points)은 앱이 시험지 모양대로 넣는다 — 튜터가 고치는 칸이 아니다.
alter table lms_exam_questions drop constraint if exists lms_exam_questions_no_check;
alter table lms_exam_questions add constraint lms_exam_questions_no_check check (no between 1 and 30);

-- 5지선다는 1–5, 단답형은 0–999. 번호에 따라 무엇을 받는지는 앱이 가린다.
alter table lms_exam_questions drop constraint if exists lms_exam_questions_answer_check;
alter table lms_exam_questions add constraint lms_exam_questions_answer_check check (answer between 0 and 999);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lms_exam_questions_exam_id_no_key'
  ) then
    alter table lms_exam_questions
      add constraint lms_exam_questions_exam_id_no_key unique (exam_id, no);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. 정오
-- 학생이 적은 답. 단답형이면 세 자리 수까지 온다.
alter table lms_answers drop constraint if exists lms_answers_chosen_check;
alter table lms_answers add constraint lms_answers_chosen_check check (chosen between 0 and 999);

-- ---------------------------------------------------------------- 5. 회차
-- 다음 수업 날. 학생 질문에 이 날까지 답을 단다 — 튜터 화면의 기한이고, 학생 화면의 약속이다.
alter table lms_exams add column if not exists due_date date;

-- ---------------------------------------------------------------- 6. 응시
-- 학생 한 명의 한 회차에 제출과 답장의 흔적을 붙인다.
alter table lms_attempts add column if not exists submitted_at      timestamptz;  -- 학생이 '제출' 을 누른 첫 시각
alter table lms_attempts add column if not exists feedback_path     text;         -- lms-files 버킷의 답변 PDF
alter table lms_attempts add column if not exists feedback_ready_at timestamptz;  -- 튜터가 다 달고 보낸 시각. 이때부터 학생이 받고, 학생 쪽은 잠긴다
alter table lms_attempts add column if not exists mailed_at         timestamptz;  -- 메일이 나간 시각
alter table lms_attempts add column if not exists mailed_to         text;
-- 메일이 실패했으면 그 이유. 신청 알림(0013)과 같은 태도다 — 실패가 로그 한 줄로만 남으면
-- '보냈겠지' 가 된다. PDF 는 메일과 상관없이 학생 화면에서 받을 수 있다.
alter table lms_attempts add column if not exists mail_error        text;

-- -------------------------------------------------------------- 7. 시험지 사진
-- 학생이 시험을 본 뒤 찍어 올린 자기 시험지. 한 장이 한 줄이다.
-- 파일은 lms-files 버킷에 있고, 여기에는 경로만 둔다. 줄을 지워도 파일은 안 지워지므로
-- 앱이 파일을 먼저 지운다 (lib/lms/files.ts).
create table if not exists lms_attempt_photos (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references lms_attempts(id) on delete cascade,
  storage_path text not null unique,
  order_index  int  not null default 0,
  bytes        int,
  created_at   timestamptz not null default now()
);

create index if not exists lms_attempt_photos_attempt_idx on lms_attempt_photos (attempt_id, order_index);

-- ------------------------------------------------------- 8. 문항별 질문과 답
-- 학생이 문항마다 적은 고민 하나와, 튜터가 단 답 하나. 0번은 '시험 전체' 자리다 —
-- 시간 배분처럼 어느 한 문항의 이야기가 아닌 것이 꼭 나온다.
-- 한 문항에 한 줄이다. 같은 문항을 두 줄로 나눠 적으면 답도 둘로 흩어진다.
create table if not exists lms_concerns (
  id                uuid primary key default gen_random_uuid(),
  attempt_id        uuid not null references lms_attempts(id) on delete cascade,
  question_no       smallint not null check (question_no between 0 and 30),
  body              text not null check (char_length(body) between 1 and 2000),
  answer            text check (answer is null or char_length(answer) between 1 and 8000),
  -- 손으로 쓴 풀이를 찍은 사진. 수식을 글로 치는 것보다 빠르고 정확하다.
  answer_image_path text,
  answered_at       timestamptz,                -- 튜터 답이 마지막으로 바뀐 시각
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),  -- 학생이 질문을 마지막으로 고친 시각
  unique (attempt_id, question_no)
);

-- ------------------------------------------------------------ 9. 채점 저장
-- 0012 와 같은 이유로 한 덩어리다. 영역 코멘트와 선택과목이 빠졌다.
-- 넘어온 문항이 이 응시의 회차 것인지도 본다 — 다른 회차의 문항 id 가 섞이면
-- 외래키로는 안 걸리고(문항은 있으니까) 점수만 조용히 엉뚱해진다.
create or replace function save_grading(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid      uuid := (payload->>'attempt_id')::uuid;
  eid      uuid;
  wanted   int  := jsonb_array_length(coalesce(payload->'answers', '[]'::jsonb));
  inserted int;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  select exam_id into eid from lms_attempts where id = aid for update;
  if eid is null then
    raise exception '없는 응시입니다: %', aid;
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
         updated_at      = now()
   where id = aid;
end;
$$;

-- --------------------------------------------------------- 10. 정답표 저장
-- 번호마다 정답 · 단원 · 배점을 적는다. 없는 줄은 만든다(1–30 이 늘 다 있게).
--
-- 정답을 고치면 그 문항은 적어 둔 학생 답으로 다시 매긴다. 정답을 잘못 넣은 채
-- 채점을 끝냈다가 나중에 고치는 일이 실제로 생기는데, 그때 채점을 처음부터 다시 하게
-- 두면 아무도 안 한다. 학생 답 없이 O/X 만 찍은 줄은 무엇을 골랐는지 몰라 그대로 둔다.
-- 돌려주는 값은 다시 매긴 정오의 수다.
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

-- ------------------------------------------------------- 11. 학생 질문 저장
-- 학생이 적은 질문을 통째로 맞춘다. 목록에서 빠진 것은 지우고, 있는 것은 고친다.
--
-- 튜터가 이미 답을 단 질문은 건드리지 않는다. 질문이 바뀌면 달아 둔 답이 엉뚱한 말이
-- 되고, 지워지면 튜터가 쓴 답이 함께 사라진다. 그리고 답 PDF 가 나간 뒤에는 통째로
-- 잠근다 — 학생이 가진 PDF 와 화면이 어긋난다.
create or replace function save_concerns(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid   uuid := (payload->>'attempt_id')::uuid;
  ready timestamptz;
  c     jsonb;
  keep  smallint[] := '{}';
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  -- 같은 응시를 잠그는 mark_feedback_ready 와 줄을 선다. 튜터가 보내는 순간에
  -- 학생이 질문을 더하면 둘 중 하나가 먼저 끝나고, 나머지는 바뀐 상태를 본다.
  select feedback_ready_at into ready from lms_attempts where id = aid for update;
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;
  if ready is not null then
    raise exception 'FEEDBACK_SENT' using errcode = 'P0001', hint = '답을 이미 받은 시험이에요';
  end if;

  for c in select * from jsonb_array_elements(coalesce(payload->'concerns', '[]'::jsonb))
  loop
    keep := keep || (c->>'question_no')::smallint;

    insert into lms_concerns (attempt_id, question_no, body)
    values (aid, (c->>'question_no')::smallint, c->>'body')
    on conflict (attempt_id, question_no) do update
       set body = excluded.body,
           updated_at = now()
     where lms_concerns.answer is null
       and lms_concerns.answer_image_path is null
       and lms_concerns.body is distinct from excluded.body;
  end loop;

  delete from lms_concerns
   where attempt_id = aid
     and not (question_no = any(keep))
     and answer is null
     and answer_image_path is null;

  if coalesce((payload->>'submit')::boolean, false) then
    update lms_attempts
       set submitted_at = coalesce(submitted_at, now()),
           updated_at   = now()
     where id = aid;
  end if;
end;
$$;

-- ------------------------------------------------------- 12. 튜터 답 저장
-- 여러 질문의 답을 한 번에. 하나라도 이 응시의 질문이 아니면 통째로 되돌린다.
-- 돌려주는 값은 답이 달린(글이든 사진이든) 질문의 수다.
create or replace function save_concern_answers(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  aid      uuid := (payload->>'attempt_id')::uuid;
  a        jsonb;
  new_text text;
  answered integer;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  perform 1 from lms_attempts where id = aid for update;
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;

  for a in select * from jsonb_array_elements(coalesce(payload->'answers', '[]'::jsonb))
  loop
    new_text := nullif(btrim(a->>'answer'), '');

    -- SET 오른쪽의 answer 는 고치기 전 값이다. 글이 실제로 바뀐 때만 시각을 새로 찍는다.
    -- updated_at 은 건드리지 않는다 — 그 칸은 '학생이 질문을 고친 시각' 이고, 튜터 화면이
    -- '제출 뒤에 바뀐 질문' 을 짚는 데 쓴다. 튜터의 답은 answered_at 에 남는다.
    update lms_concerns
       set answer      = new_text,
           answered_at = case
                           when new_text is null and answer_image_path is null then null
                           when answer is distinct from new_text then now()
                           else answered_at
                         end
     where id = (a->>'id')::uuid
       and attempt_id = aid;

    if not found then
      raise exception '이 응시의 질문이 아닙니다: %', a->>'id';
    end if;
  end loop;

  select count(*) into answered
    from lms_concerns
   where attempt_id = aid
     and (answer is not null or answer_image_path is not null);

  return answered;
end;
$$;

-- ------------------------------------------------- 13. 답을 다 달았다고 표시
-- PDF 를 만들어 올린 뒤에 부른다. 여기서 한 번 더 본다 —
--   · 답이 안 달린 질문이 하나라도 있으면 멈춘다 ('다 단 것이 확인되면' 보낸다)
--   · PDF 에 담긴 질문과 지금 질문 목록이 다르면 멈춘다. 튜터가 화면을 연 사이에
--     학생이 질문을 하나 더 올렸다면, 그 질문은 PDF 에 없는데 학생 쪽은 잠겨 버린다.
-- 둘 다 save_concerns 와 같은 잠금 안에서 본다.
create or replace function mark_feedback_ready(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid      uuid := (payload->>'attempt_id')::uuid;
  included uuid[];
  now_ids  uuid[];
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

  update lms_attempts
     set feedback_path     = payload->>'path',
         feedback_ready_at = now(),
         updated_at        = now()
   where id = aid;
end;
$$;

-- -------------------------------------------------------------- 14. 저장소
-- 학생 시험지 사진 · 튜터 풀이 사진 · 답변 PDF. 접수 흐름의 exam-papers 와 섞지 않는다 —
-- 저건 30일 뒤 지우는 버킷이고, 이건 수업이 이어지는 동안 남아야 한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lms-files', 'lms-files', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------ 15. RLS
-- 0008 과 같다. 앱은 service_role 로만 붙고, 공개 키가 새도 표가 열려 있지 않게 켜 둔다.
alter table lms_attempt_photos enable row level security;
alter table lms_concerns       enable row level security;

-- ----------------------------------------------------- 16. 서버 전용 함수 잠금
-- 0014 와 같은 이유. 새로 만든 함수도 공개 키로는 못 부르게 한다.
-- (0014 가 기본 권한을 거둬 뒀지만, 그 설정은 만든 사람(role)마다 따로라 여기서 한 번 더 한다.)
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_grading(jsonb)',
    'save_answer_key(jsonb)',
    'save_concerns(jsonb)',
    'save_concern_answers(jsonb)',
    'mark_feedback_ready(jsonb)'
  ]
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------- 17. 설치 점검
-- 0014 의 것을 그대로 두고 'lms_math' · 'lms_bucket' 두 줄을 더하고,
-- 잠금 확인 목록에 새 함수를 넣는다. 여기서 빠뜨리면 /setup 의 '수학 수업 표' 가 빨간불이 된다.
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
    'class_schema', (
      to_regclass('public.classes') is not null and
      to_regclass('public.class_applications') is not null and
      to_regprocedure('public.create_class_application(jsonb)') is not null and
      -- 0006 이 넣은 열
      exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'classes' and column_name = 'mock_exam'
      )
    ),
    'proof_bucket', (select count(*) > 0 from storage.buckets where id = 'tutor-proof' and public = false),
    'bucket', (select count(*) > 0 from storage.buckets where id = 'exam-papers' and public = false),
    'submission_count', (select count(*) from submissions),
    'pending_count', (select count(*) from submissions where status in ('submitted','processing','failed')),
    'failure_count', (select count(*) from sync_failures where not resolved),
    'daily_capacity', (select daily_capacity from app_settings where id = 1),
    'today_count', today_receipt_count(),
    -- 0004 가 넣은 검사. 여기서 빠뜨리면 /setup 의 '과목 원점수' 가 빨간불이 된다.
    'raw_score', (
      select count(*) > 0 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'submission_subjects'
         and column_name = 'raw_score'
    ),
    -- 0013 이 넣은 검사
    'apply_alert', (
      select count(*) = 2 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'class_applications'
         and column_name in ('alert_sent_at', 'alert_error')
    ),
    'open_class_count', (select count(*) from classes where status = 'open'),
    'application_count', (select count(*) from class_applications where status <> 'canceled'),
    -- 알림이 실패했는데 아직 아무도 손대지 않은 신청 (0013)
    'alert_failed_count', (
      select count(*) from class_applications
       where alert_error is not null and status = 'new'
    ),
    -- 0015 가 넣은 검사. 수학 수업의 표 · 함수 · 열이 다 있어야 참.
    'lms_math', (
      to_regclass('public.lms_attempt_photos') is not null and
      to_regclass('public.lms_concerns') is not null and
      to_regprocedure('public.save_answer_key(jsonb)') is not null and
      to_regprocedure('public.save_concerns(jsonb)') is not null and
      to_regprocedure('public.save_concern_answers(jsonb)') is not null and
      to_regprocedure('public.mark_feedback_ready(jsonb)') is not null and
      exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'lms_exam_questions' and column_name = 'unit_code'
      ) and
      exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'lms_attempts' and column_name = 'feedback_ready_at'
      )
    ),
    'lms_bucket', (select count(*) > 0 from storage.buckets where id = 'lms-files' and public = false),
    -- 0014 가 넣은 검사. 서버 전용 함수 중 공개 키로 부를 수 있는 것이 하나도 없어야 참.
    -- 이름으로 찾으므로 아직 안 만든 함수는 그냥 건너뛴다.
    'rpc_locked', not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'create_submission', 'next_receipt_no', 'today_receipt_count', 'claim_submission',
           'setup_status', 'create_class_application', 'purge_expired_applications', 'save_grading',
           'save_answer_key', 'save_concerns', 'save_concern_answers', 'mark_feedback_ready'
         )
         and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
    )
  );
$$;
