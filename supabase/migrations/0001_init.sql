-- 9모 시험지 피드백 v1 — 초기 스키마 (PRD §7.2)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 한 번 실행한다. 여러 번 실행해도 안전하다.

-- ================================================================ 1. 테이블

-- 접수 단위
create table if not exists submissions (
  id              uuid primary key default gen_random_uuid(),
  receipt_no      text unique not null,               -- F0902-013
  exam_code       text not null,                      -- G3_KICE | G2_ICE | G1_ICE
  grade           smallint not null check (grade between 1 and 3),
  email           text not null,
  consent_at      timestamptz not null,
  status          text not null default 'submitted',  -- submitted|processing|synced|failed
  notion_ok       boolean default false,
  sheet_ok        boolean default false,
  purge_after     date not null,                      -- 이 날짜가 지나면 사진·PDF 를 지운다
  idempotency_key text unique,                        -- 같은 제출을 두 번 눌러도 1건 (BE-2)
  created_at      timestamptz default now()
);

-- 과목 단위 (= 시트 1행, Notion 1페이지)
create table if not exists submission_subjects (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references submissions(id) on delete cascade,
  subject_code    text not null,                      -- korean|math|english|int_sci|int_soc
  concerns        jsonb not null default '{}',        -- {q1:"", ... q5:""}
  pdf_path        text,
  page_count      int default 0,
  notion_page_id  text,
  unique (submission_id, subject_code)
);

-- 원본 이미지
create table if not exists submission_files (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid references submission_subjects(id) on delete cascade,
  storage_path    text not null,
  order_index     int not null,
  bytes           int,
  created_at      timestamptz default now()
);

create index if not exists submission_subjects_submission_idx on submission_subjects (submission_id);
create index if not exists submission_files_subject_idx on submission_files (subject_id, order_index);
create index if not exists submissions_purge_idx on submissions (purge_after);
create index if not exists submissions_created_idx on submissions (created_at desc);

-- ==================================================== 2. 접수 스위치 (OPS-1)
-- 배포 없이 바꾸는 값들. Table Editor 에서 이 한 줄만 고치면 사이트에 바로 반영된다.
create table if not exists app_settings (
  id                integer primary key default 1 check (id = 1),
  intake_open       boolean not null default true,           -- 접수 전체 on/off
  capacity          integer,                                 -- 접수 상한. 비워두면 무제한
  closed_reason     text not null default '이번 회차 접수가 마감됐어요.',
  disabled_subjects text[] not null default '{}',            -- 과목별 off. 예: {english,int_sci,int_soc}
  updated_at        timestamptz not null default now()
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ================================================== 3. 접수번호 발급 (BE-2)
-- 형식: F{MMDD}-{일련번호 3자리}. 한국 날짜가 바뀌면 001 부터 다시 센다.
create table if not exists receipt_counters (
  day date primary key,
  seq int not null default 0
);

create or replace function next_receipt_no(at timestamptz default now())
returns text
language plpgsql
as $$
declare
  d date := (at at time zone 'Asia/Seoul')::date;
  n int;
begin
  insert into receipt_counters (day, seq) values (d, 1)
  on conflict (day) do update set seq = receipt_counters.seq + 1
  returning seq into n;

  return 'F' || to_char(d, 'MMDD') || '-' || lpad(n::text, 3, '0');
end;
$$;

-- ====================================================== 4. 제출 (BE-2 원자성)
-- 접수 1건 + 과목 n건 + 파일 m건을 한 트랜잭션에서 만든다. 중간에 실패하면 통째로 없던 일이 된다.
-- payload 예시:
-- {
--   "idempotency_key": "...", "exam_code": "G3_KICE", "grade": 3,
--   "email": "a@b.com", "consent_at": "2026-09-02T09:41:00Z", "purge_after": "2026-10-02",
--   "subjects": [
--     { "subject_code": "math", "concerns": {"q1": "..."},
--       "files": [{"storage_path": "raw/...", "order_index": 0, "bytes": 512000}] }
--   ]
-- }
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
begin
  -- 같은 제출을 두 번 눌렀으면 이미 만든 접수번호를 그대로 돌려준다
  select receipt_no into existing
    from submissions
   where idempotency_key = payload->>'idempotency_key';
  if existing is not null then
    return existing;
  end if;

  new_no := next_receipt_no();

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
exception
  when unique_violation then
    -- 동시에 두 번 눌린 경우: 먼저 들어간 쪽의 접수번호를 돌려준다
    select receipt_no into existing
      from submissions
     where idempotency_key = payload->>'idempotency_key';
    if existing is not null then
      return existing;
    end if;
    raise;
end;
$$;

-- =============================================== 4-1. 설치 점검 (/setup 화면용)
-- 사이트의 /setup 페이지가 이 함수를 불러 무엇이 준비됐는지 보여준다.
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
      to_regproc('public.create_submission(jsonb)') is not null and
      to_regproc('public.next_receipt_no(timestamptz)') is not null
    ),
    'bucket', (select count(*) > 0 from storage.buckets where id = 'exam-papers' and public = false),
    'submission_count', (select count(*) from submissions)
  );
$$;

-- ============================================================== 5. RLS
-- 익명 클라이언트는 접수 스위치만 읽을 수 있다. 접수 데이터는 읽기·쓰기 모두 막고,
-- 서버(service_role)만 create_submission 으로 넣는다.
alter table submissions         enable row level security;
alter table submission_subjects enable row level security;
alter table submission_files    enable row level security;
alter table app_settings        enable row level security;
alter table receipt_counters    enable row level security;

drop policy if exists app_settings_public_read on app_settings;
create policy app_settings_public_read on app_settings
  for select to anon, authenticated using (true);

-- ========================================================== 6. 스토리지
-- 비공개 버킷. 업로드는 서버가 발급한 서명 URL 로만, 열람도 유효기간 있는 서명 URL 로만. (BE-1 / SEC-1)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-papers', 'exam-papers', false, 10485760, array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 버킷에 대한 anon 정책은 만들지 않는다 = 익명 접근 전면 차단.
