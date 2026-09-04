-- ============================================================================
-- 0005 — 개설 클래스와 신청 (모집 페이지 PRD §04·§06)
--
-- 두 표를 더한다.
--   classes             — /class 에 보이는 반. 값은 /admin 에서 고친다.
--   class_applications  — 신청 한 건. 학생이 채우는 칸은 넷뿐이다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- ------------------------------------------------------------------ 1. 반
create table if not exists classes (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,          -- korean-thu-19
  subject_code     text not null default 'korean',
  title            text not null,
  schedule_text    text not null,                 -- 매주 목요일 19:00–22:00
  starts_on        date,
  sessions         int  not null default 4,
  location         text not null default '',
  tutor_name       text not null default '',
  tutor_school     text,                          -- 학교 · 학번
  tutor_percentile numeric(4,1),                  -- 국어 평균 백분위
  proof_paths      text[] not null default '{}',  -- tutor-proof 버킷 경로
  recommend        text,                          -- 권장 수강 대상 한 줄
  detail           text,                          -- 수업 상세 설명
  capacity         int  not null default 3 check (capacity between 1 and 20),
  price            int  not null default 498000 check (price >= 0),
  price_note       text not null default '4회 총액 · 모의고사 4회분, 스터디룸, 수업 후 피드백 포함',
  status           text not null default 'draft' check (status in ('draft','open','closed')),
  sort_order       int  not null default 0,
  updated_at       timestamptz not null default now()
);

create index if not exists classes_open_idx on classes (status, sort_order, starts_on);

-- -------------------------------------------------------------- 2. 신청
-- 학생이 채우는 칸: 이름 · 9모 접수번호 · 학부모 연락처 · 동의.
-- 학년·이메일·그때 적어준 고민은 묻지 않고 접수번호로 조회한다.
create table if not exists class_applications (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete restrict,
  student_name  text not null,
  receipt_no    text,                              -- F0902-013. 못 찾으면 비어 있을 수 있다
  parent_phone  text not null,
  consent_at    timestamptz not null,
  status        text not null default 'new'
                check (status in ('new','contacted','paid','canceled')),
  memo          text,
  purge_after   date not null,                     -- 신청일 + 90일
  created_at    timestamptz not null default now()
);

create index if not exists class_applications_class_idx
  on class_applications (class_id, created_at desc);
create index if not exists class_applications_purge_idx
  on class_applications (purge_after);

-- ------------------------------------------------- 3. 신청 (정원 초과 차단)
-- 화면에서만 막으면 마지막 자리를 동시에 누른 두 명이 둘 다 통과한다.
-- 하루 접수 상한(0003)에서 이미 겪은 문제라 같은 방식으로 막는다 —
-- 반 행을 잠그고, 잠근 상태에서 세고, 넘으면 통째로 되돌린다.
create or replace function create_class_application(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid    uuid;
  cap    int;
  taken  int;
  new_id uuid;
begin
  select id, capacity into cid, cap
    from classes
   where slug = payload->>'slug'
     and status = 'open'
   for update;

  if cid is null then
    raise exception 'CLASS_NOT_OPEN' using errcode = 'P0001', hint = '지금 신청을 받고 있지 않은 반이에요';
  end if;

  select count(*) into taken
    from class_applications
   where class_id = cid
     and status <> 'canceled';

  if taken >= cap then
    raise exception 'CLASS_FULL' using errcode = 'P0001', hint = '자리가 다 찼어요';
  end if;

  insert into class_applications
    (class_id, student_name, receipt_no, parent_phone, consent_at, purge_after)
  values (
    cid,
    payload->>'student_name',
    nullif(payload->>'receipt_no', ''),
    payload->>'parent_phone',
    (payload->>'consent_at')::timestamptz,
    (payload->>'purge_after')::date
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ------------------------------------------------------ 4. 90일 지난 신청 삭제
-- 사진과 달리 행 자체를 지운다. 남겨 둘 이유가 없는 개인정보다.
create or replace function purge_expired_applications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with gone as (
    delete from class_applications
     where purge_after < (now() at time zone 'Asia/Seoul')::date
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;

-- ------------------------------------------------------------------ 5. RLS
-- 익명 정책을 만들지 않는다 = 브라우저에서 직접 못 읽고 못 쓴다.
-- /class 는 서버 컴포넌트가 service_role 로 읽어서 그린다.
alter table classes            enable row level security;
alter table class_applications enable row level security;

-- ------------------------------------------------------------- 6. 증빙 버킷
-- 학생 시험지(exam-papers)와 섞지 않는다 — 저건 30일 뒤 지우고, 이건 남긴다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-proof', 'tutor-proof', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------- 7. 설치 점검에 노출
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
      to_regprocedure('public.create_class_application(jsonb)') is not null
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
    'open_class_count', (select count(*) from classes where status = 'open'),
    'application_count', (select count(*) from class_applications where status <> 'canceled')
  );
$$;
