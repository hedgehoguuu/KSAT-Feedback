-- ============================================================================
-- 0016 — 학생 시험지 사진으로 자동 채점
--
-- 학생이 시험지 사진을 올리면 서버가 사진에서 학생이 고른 · 적은 답을 읽고(Claude),
-- 정답표와 맞춰 채점을 채운다. 튜터는 확인하고 공개만 하면 된다.
--
-- 지키는 것 넷.
--   1) 확실히 읽힌 답만 매긴다. 애매한 문항은 비워 두고 튜터 화면이 짚어 준다. 채점이 덜
--      끝난 것으로 남으니, 확인하기 전에는 일괄 공개에도 답변 PDF 의 점수에도 안 들어간다.
--   2) 튜터가 저장한 채점은 덮지 않는다. 그래서 채점을 누가 적었는지(answers_source)를 둔다.
--      점수를 공개한 응시도 덮지 않는다.
--   3) 사진이 바뀌면 옛 사진으로 매긴 채점은 그 자리에서 사라진다 (사진을 넣고 지우는 바로
--      그 트랜잭션 안에서). 새 읽기가 늦거나 실패하거나 횟수 상한에 걸려도 옛 점수가 남아
--      공개되는 일이 없다. 읽은 결과를 적을 때와 채점에 옮길 때마다 지금 사진 묶음과
--      같은지도 다시 본다.
--   4) 늦게 끝난 옛 읽기가 새 결과를 덮지 않는다. 읽기를 부를 때마다 번호(request_no)를
--      올리고, 끝날 때 그 번호가 아직 최신인지 본다.
--
-- 잠그는 순서는 모든 함수와 트리거에서 같다: 회차 → 응시 → 읽기 · 답안.
-- 순서가 엇갈리면 서로 기다리다 한쪽이 죽는다. 답안(lms_answers)을 지우거나 고치기 전에는
-- 반드시 그 응시 행을 먼저 잠근다 — 여러 응시면 id 순으로.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 지금 돌고 있는 앱(0015)과도 맞는다 — 먼저 돌리고 배포해도 된다.
-- ============================================================================

-- ------------------------------------------------------ 1. 채점을 누가 적었나
-- photo = 사진 읽기가 채움 · tutor = 튜터가 채점 화면에서 저장함 · null = 아직 아무도.
alter table lms_attempts add column if not exists answers_source text
  check (answers_source in ('photo', 'tutor'));

-- 지금까지의 채점은 전부 튜터가 손으로 한 것이다.
update lms_attempts a
   set answers_source = 'tutor'
 where answers_source is null
   and exists (select 1 from lms_answers x where x.attempt_id = a.id);

-- -------------------------------------------------------------- 2. 사진 읽기
-- 응시 하나에 한 줄. 새로 읽으면 그 줄을 고쳐 쓴다 — 지난 읽기의 결과는 남길 까닭이 없다.
create table if not exists lms_photo_reads (
  attempt_id   uuid primary key references lms_attempts(id) on delete cascade,
  -- 부를 때마다 1씩 는다. 끝난 읽기는 자기 번호가 아직 최신일 때만 결과를 적는다.
  request_no   int  not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  -- 이번에 읽은 사진. 지금 사진과 다르면 결과가 낡은 것이다.
  photo_ids    uuid[] not null default '{}',
  -- 번호마다 한 줄: {no, answer, sure, note}. answer 가 null 이면 빈칸이거나 못 읽은 것이고,
  -- 둘은 sure 로 가른다 (빈칸이 확실하면 sure).
  answers      jsonb not null default '[]'::jsonb,
  -- 흐리거나 잘려서 못 읽은 사진. 학생 화면이 그 사진에 '다시 찍어 주세요' 를 붙인다.
  unreadable   uuid[] not null default '{}',
  note         text,
  -- 실패 이유 코드 (config/lms.ts 의 PHOTO_READ_ERRORS)
  error        text,
  -- 모델을 실제로 부른 횟수. 학생 쪽 변화로 자동으로 부르는 횟수에 상한을 두는 데 쓴다.
  runs         int  not null default 0,
  updated_at   timestamptz not null default now()
);

-- 매일 새벽 정리가 멈추거나 실패한 읽기를 찾는다.
create index if not exists lms_photo_reads_status_idx on lms_photo_reads (status, updated_at);

-- 0008 과 같다. 앱은 service_role 로만 붙고, 공개 키가 새도 표가 열려 있지 않게 켜 둔다.
alter table lms_photo_reads enable row level security;

-- -------------------------------------------------- 3. 사진 묶음이 같은가
-- 순서는 보지 않는다 — 문항 번호가 사진에 적혀 있어서 순서를 바꿔도 읽은 결과는 같다.
create or replace function lms_photo_set_is(aid uuid, ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select array_agg(id order by id) from lms_attempt_photos where attempt_id = aid), '{}'::uuid[])
       = coalesce((select array_agg(distinct x order by x) from unnest(ids) as x), '{}'::uuid[]);
$$;

-- ---------------------------------------- 4. 사진이 바뀌면 사진으로 매긴 채점을 비운다
-- 사진 행을 넣거나 지우는 바로 그 트랜잭션 안에서 돈다. 앱이 따로 부르면 그 사이에 일괄
-- 공개나 답변 PDF 가 옛 사진의 점수를 가져갈 수 있다. 새 읽기는 앱이 부르고, 읽기가 끝나면
-- 다시 채운다 — 부르는 횟수에 상한이 걸려도 여기는 상관없이 돈다.
--
-- 사진으로 채운 비공개 채점만 비운다. 튜터가 매긴 채점과 공개한 점수는 사람이 정한 것이라 둔다.
-- 순서만 바꾸는 것(order_index)은 사진 묶음이 그대로라 걸지 않는다.
--
-- BEFORE 로 거는 까닭: 사진 행을 넣으면 외래키 확인이 응시 행에 공유 잠금을 거는데, 그 뒤에
-- 같은 행을 쓰기 잠금으로 올리면 같은 응시에 사진 두 장이 동시에 들어올 때 서로를 기다리다
-- 멈춘다. 쓰기 잠금을 먼저 잡으면 두 번째 사진은 줄을 선다.
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
begin
  select status, answers_source into att_status, att_source
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

-- ---------------------------------------------- 5. 읽은 답을 채점에 옮기기 (안쪽)
-- 부르는 쪽이 응시 행을 잠근 채로 부른다. 채점을 통째로 다시 적는다 — 사진이 바뀌어
-- 전에 읽힌 답이 사라졌으면 그 문항의 정오도 사라져야 한다.
--
-- 옮기지 않을 때는 -1 을 돌려준다:
--   · 점수를 이미 공개한 응시
--   · 튜터가 저장한 채점 (force 면 덮는다 — 튜터가 '읽은 답으로 다시 매기기' 를 누른 것)
--   · 다 끝난 읽기가 없거나, 그 읽기가 지금 사진 묶음을 읽은 것이 아닐 때
-- 옮겼으면 매긴 문항 수를 돌려준다.
create or replace function apply_photo_read_locked(aid uuid, force boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  att_exam   uuid;
  att_status text;
  att_source text;
  rd_status  text;
  rd_answers jsonb;
  rd_photos  uuid[];
  n          integer;
begin
  select exam_id, status, answers_source
    into att_exam, att_status, att_source
    from lms_attempts
   where id = aid;
  if att_exam is null or att_status <> 'draft' then
    return -1;
  end if;
  if att_source = 'tutor' and not coalesce(force, false) then
    return -1;
  end if;

  select status, answers, photo_ids
    into rd_status, rd_answers, rd_photos
    from lms_photo_reads
   where attempt_id = aid;
  if rd_status is distinct from 'done' then
    return -1;
  end if;
  if not lms_photo_set_is(aid, rd_photos) then
    return -1;
  end if;

  delete from lms_answers where attempt_id = aid;

  -- 확실히 읽힌 것만 매긴다. 빈칸이 확실하면 틀린 것으로 — 손으로 매길 때도 그렇다.
  -- 정답이 아직 없는 문항은 매길 수 없어 건너뛴다. 정답을 넣으면 save_answer_key 가 다시 부른다.
  insert into lms_answers (attempt_id, question_id, correct, chosen)
  select distinct on (q.id)
         aid,
         q.id,
         coalesce(r.answer = q.answer, false),
         r.answer
    from jsonb_to_recordset(rd_answers) as r(no int, answer int, sure boolean)
    join lms_exam_questions q on q.exam_id = att_exam and q.no = r.no
   where r.sure
     and q.answer is not null
   order by q.id;
  get diagnostics n = row_count;

  update lms_attempts
     set answers_source = 'photo',
         updated_at     = now()
   where id = aid;

  return n;
end;
$$;

-- ------------------------------------------------- 6. 읽은 답을 채점에 옮기기
-- 튜터 화면의 '읽은 답으로 (다시) 매기기'. force 가 아니면 튜터 채점은 그대로 둔다.
create or replace function apply_photo_read(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid := (payload->>'attempt_id')::uuid;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  perform 1 from lms_attempts where id = aid for update;
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;

  return apply_photo_read_locked(aid, coalesce((payload->>'force')::boolean, false));
end;
$$;

-- ---------------------------------------------------------- 7. 읽기를 부른다
-- 번호를 하나 올리고 '기다림' 으로 둔다. 돌려주는 값이 이번 읽기의 번호다.
-- max_runs 를 주면(학생 쪽 자동 읽기) 모델을 이미 그만큼 불렀을 때 0 을 돌려주고 부르지 않는다.
-- 상한에 걸려도 옛 사진의 채점은 이미 비워져 있다 (4번). 읽는 중이던 옛 읽기는 끝날 때
-- 사진 묶음이 달라 버려진다 (9번).
create or replace function request_photo_read(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  aid  uuid := (payload->>'attempt_id')::uuid;
  cap  int  := nullif(payload->>'max_runs', '')::int;
  used int;
  req  int;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  perform 1 from lms_attempts where id = aid for update;
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;

  insert into lms_photo_reads (attempt_id) values (aid) on conflict (attempt_id) do nothing;
  select runs into used from lms_photo_reads where attempt_id = aid for update;
  if cap is not null and used >= cap then
    return 0;
  end if;

  update lms_photo_reads
     set request_no   = request_no + 1,
         status       = 'pending',
         requested_at = now(),
         error        = null,
         updated_at   = now()
   where attempt_id = aid
  returning request_no into req;

  return req;
end;
$$;

-- ------------------------------------------------------ 8. 읽기를 시작한다
-- 이 번호가 아직 최신이고 기다리는 중일 때만 '읽는 중' 으로 바꾸고 참을 돌려준다.
-- 조용히 기다리는 사이 새 사진이 와서 번호가 올랐으면 거짓 — 모델을 부르지 않는다.
create or replace function claim_photo_read(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid := (payload->>'attempt_id')::uuid;
begin
  perform 1 from lms_attempts where id = aid for update;
  if not found then
    return false;
  end if;

  update lms_photo_reads
     set status     = 'running',
         started_at = now(),
         runs       = runs + 1,
         updated_at = now()
   where attempt_id = aid
     and request_no = (payload->>'request_no')::int
     and status     = 'pending';
  return found;
end;
$$;

-- --------------------------------------------------------- 9. 읽기를 마친다
-- 결과를 적고 채점에 옮긴다. 응시를 잠근 채로 본다 — 사진을 넣고 지우는 트리거(4번)가 같은
-- 잠금을 기다리므로, 여기서 본 사진 묶음은 끝날 때까지 바뀌지 않는다. 돌려주는 값:
--   STALE    더 새 읽기가 있어서 이 결과는 버렸다
--   CHANGED  읽는 사이 사진이 바뀌었다. 버리고 '실패(PHOTOS_CHANGED)' 로 적었다
--   APPLIED  적고 채점까지 옮겼다
--   KEPT     적기만 했다 (튜터 채점이거나 이미 공개한 응시)
create or replace function finish_photo_read(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  aid        uuid := (payload->>'attempt_id')::uuid;
  req        int  := (payload->>'request_no')::int;
  ids        uuid[] := coalesce(array(select jsonb_array_elements_text(payload->'photo_ids'))::uuid[], '{}');
  cur_no     int;
  cur_status text;
begin
  if aid is null or req is null then
    raise exception 'attempt_id 와 request_no 가 필요합니다';
  end if;

  perform 1 from lms_attempts where id = aid for update;
  if not found then
    return 'STALE';
  end if;

  select request_no, status into cur_no, cur_status
    from lms_photo_reads
   where attempt_id = aid
     for update;
  if cur_no is distinct from req or cur_status is distinct from 'running' then
    return 'STALE';
  end if;

  if not lms_photo_set_is(aid, ids) then
    update lms_photo_reads
       set status      = 'failed',
           finished_at = now(),
           error       = 'PHOTOS_CHANGED',
           updated_at  = now()
     where attempt_id = aid;
    return 'CHANGED';
  end if;

  update lms_photo_reads
     set status      = 'done',
         finished_at = now(),
         photo_ids   = ids,
         answers     = coalesce(payload->'answers', '[]'::jsonb),
         unreadable  = coalesce(array(select jsonb_array_elements_text(payload->'unreadable'))::uuid[], '{}'),
         note        = nullif(btrim(coalesce(payload->>'note', '')), ''),
         error       = null,
         updated_at  = now()
   where attempt_id = aid;

  if apply_photo_read_locked(aid, false) >= 0 then
    return 'APPLIED';
  end if;
  return 'KEPT';
end;
$$;

-- ------------------------------------------------------ 10. 읽기가 실패했다
-- 이 번호가 아직 최신일 때만 적는다. 더 새 읽기가 돌고 있으면 그쪽 상태가 맞다.
create or replace function fail_photo_read(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update lms_photo_reads
     set status      = 'failed',
         finished_at = now(),
         error       = left(coalesce(nullif(payload->>'error', ''), 'UNKNOWN'), 300),
         updated_at  = now()
   where attempt_id = (payload->>'attempt_id')::uuid
     and request_no = (payload->>'request_no')::int
     and status in ('pending', 'running');
end;
$$;

-- ----------------------------------------------------------- 11. 채점 저장
-- 0015 와 같고, 둘을 더한다.
--   · 채점을 누가 적었는지(answers_source). 튜터가 한 문항이라도 매겨 저장하면 튜터 채점이다
--     — 사진을 다시 읽어도 덮지 않는다. 아무것도 안 매기고 총평만 저장했으면 누구의 채점도
--     아니다. 그때는 사진이 오면 채운다.
--   · rev — 화면이 본 응시의 updated_at. 잠근 뒤에 지금 값과 견줘 다르면 STALE 로 멈춘다.
--     학생이 사진을 바꾸면(4번) 사진으로 매긴 채점이 그 자리에서 비워지고 updated_at 이 오른다.
--     그걸 보기 전에 열어 둔 화면으로 저장하면 사라진 옛 사진의 점수가 되살아나 공개될 수
--     있다 — 화면을 지우는 것으로는 못 막는다. 잠근 안에서 봐야 한다.
--     rev 없이 부르면(0015 의 앱) 예전과 똑같이 돈다.
create or replace function save_grading(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid      uuid := (payload->>'attempt_id')::uuid;
  rev      text := nullif(payload->>'rev', '');
  eid      uuid;
  seen     timestamptz;
  wanted   int  := jsonb_array_length(coalesce(payload->'answers', '[]'::jsonb));
  inserted int;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  select exam_id, updated_at into eid, seen from lms_attempts where id = aid for update;
  if eid is null then
    raise exception '없는 응시입니다: %', aid;
  end if;

  if rev is not null and seen is distinct from rev::timestamptz then
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

-- -------------------------------------------------------- 12. 정답표 저장
-- 0015 와 같고, 끝에 한 가지를 더한다: 사진으로 채운 채점은 읽어 둔 답으로 다시 채운다.
-- 정답이 비어 있던 문항은 위의 '다시 매기기' 로는 정오가 안 생긴다 — 줄이 아예 없었으니까.
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
  -- 사진 변경 트리거(4번)는 응시 → 답안 순으로 잠근다. 여기서 답안을 먼저 잠그면(아래 다시
  -- 매기기) 서로 상대가 쥔 잠금을 기다리다 한쪽이 죽는다 — 정답표 저장이나 학생 사진
  -- 올리기가 실패한다. 이 회차의 응시 수는 한 반이라 잠깐이다.
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

-- -------------------------------------------------------- 13. 한꺼번에 공개
-- 화면이 '채점 끝' 이라고 본 응시를 넘겨받아, 응시를 잠근 채로 **지금도** 다 매겨져 있는
-- 비공개 응시만 공개한다. 화면을 그린 뒤 학생이 사진을 바꿔 사진 채점이 비워졌으면 빠진다.
-- 공개한 수를 돌려준다.
create or replace function publish_grades(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  eid   uuid := (payload->>'exam_id')::uuid;
  total int;
  aid   uuid;
  n     int := 0;
begin
  if eid is null then
    raise exception 'exam_id 가 없습니다';
  end if;

  select count(*) into total from lms_exam_questions where exam_id = eid;
  if total = 0 then
    return 0;
  end if;

  for aid in
    select a.id
      from lms_attempts a
     where a.exam_id = eid
       and a.status = 'draft'
       and a.id = any(coalesce(array(select jsonb_array_elements_text(payload->'attempt_ids'))::uuid[], '{}'))
     order by a.id
       for update
  loop
    -- 정오는 (응시, 문항) 에 한 줄이고 이 회차 문항에만 붙는다 (save_grading · 5번). 수가 같으면 다 매긴 것이다.
    if (select count(*) from lms_answers where attempt_id = aid) = total then
      update lms_attempts
         set status     = 'published',
             updated_at = now()
       where id = aid;
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

-- ------------------------------------------------ 14. 답을 다 달았다고 표시
-- 0015 와 같고 둘을 더한다. publish 가 참이면(PDF 에 점수가 들어갔고 아직 비공개) —
--   · PDF 를 만들 때 읽은 정오(answers)와 지금 정오가 같은지 본다. 그사이 학생이 사진을 바꿔
--     사진 채점이 비워졌거나 튜터가 다시 매겼으면 REGRADED 로 멈춘다. PDF 의 점수와 학생
--     화면의 점수가 달라지면 안 된다.
--   · 같으면 '보냄' 과 함께 점수도 공개한다. 따로 부르면 그 사이에 채점이 바뀔 수 있다.
-- 둘 다 없이 부르면(0015 의 앱) 예전과 똑같이 돈다.
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

  if publish then
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

-- ----------------------------------------------------- 15. 서버 전용 함수 잠금
-- 0014 · 0015 와 같은 이유. 새로 만든 함수도 공개 키로는 못 부르게 한다.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'apply_photo_read(jsonb)',
    'request_photo_read(jsonb)',
    'claim_photo_read(jsonb)',
    'finish_photo_read(jsonb)',
    'fail_photo_read(jsonb)',
    'publish_grades(jsonb)',
    'save_grading(jsonb)',
    'save_answer_key(jsonb)',
    'mark_feedback_ready(jsonb)'
  ]
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;

  -- 안쪽 함수는 다른 함수와 트리거만 부른다. 누구에게도 열지 않는다.
  foreach fn in array array[
    'apply_photo_read_locked(uuid, boolean)',
    'lms_photo_set_is(uuid, uuid[])',
    'lms_photos_changed()'
  ]
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------- 16. 설치 점검
-- 0015 의 것을 그대로 두고 'lms_photo_read' 한 줄을 더하고, 잠금 확인 목록에 새 함수를 넣는다.
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
    -- 0016 이 넣은 검사. 사진 자동 채점의 표 · 함수 · 트리거 · 열이 다 있어야 참.
    'lms_photo_read', (
      to_regclass('public.lms_photo_reads') is not null and
      to_regprocedure('public.request_photo_read(jsonb)') is not null and
      to_regprocedure('public.claim_photo_read(jsonb)') is not null and
      to_regprocedure('public.finish_photo_read(jsonb)') is not null and
      to_regprocedure('public.fail_photo_read(jsonb)') is not null and
      to_regprocedure('public.apply_photo_read(jsonb)') is not null and
      to_regprocedure('public.publish_grades(jsonb)') is not null and
      exists (
        select 1 from pg_trigger
         where tgname = 'lms_photos_changed'
           and tgrelid = 'public.lms_attempt_photos'::regclass
      ) and
      exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'lms_attempts' and column_name = 'answers_source'
      )
    ),
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
           'save_answer_key', 'save_concerns', 'save_concern_answers', 'mark_feedback_ready',
           'apply_photo_read_locked', 'apply_photo_read', 'request_photo_read', 'claim_photo_read',
           'finish_photo_read', 'fail_photo_read', 'publish_grades', 'lms_photo_set_is', 'lms_photos_changed'
         )
         and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
    )
  );
$$;
