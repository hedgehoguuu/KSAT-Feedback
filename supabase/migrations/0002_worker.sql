-- 8/30 워커 작업분 — PDF 병합 · Notion 자동 등록 · 접수 확인 메일
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 한 번 실행한다. 여러 번 실행해도 안전하다.

-- ------------------------------------------------- 1. 처리 상태 컬럼 추가
alter table submissions add column if not exists email_ok      boolean default false;
alter table submissions add column if not exists processed_at   timestamptz;
alter table submissions add column if not exists process_attempts int not null default 0;
alter table submissions add column if not exists claimed_at     timestamptz;

-- ------------------------------------------------------- 2. 실패 로그
-- PRD 의 `_실패` 시트가 하던 역할. 어느 접수의 어느 단계에서 왜 막혔는지 남긴다.
create table if not exists sync_failures (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid references submissions(id) on delete cascade,
  receipt_no    text,
  stage         text not null,        -- pdf | notion | email
  subject_code  text,
  error         text,
  attempts      int  not null default 1,
  resolved      boolean not null default false,
  created_at    timestamptz default now()
);

create index if not exists sync_failures_open_idx on sync_failures (resolved, created_at desc);

alter table sync_failures enable row level security;   -- 정책 없음 = service_role 만 접근

-- --------------------------------------------- 3. 처리할 접수 집어오기
-- 아직 안 끝났거나 실패한 접수를 한 번에 하나씩 잠그고 가져온다.
-- 두 개의 요청이 같은 접수를 동시에 처리하지 않도록 status 를 'processing' 으로 먼저 바꾼다.
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
       status in ('submitted', 'failed')
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

-- --------------------------------------------------- 4. 설치 점검 갱신
-- /setup 화면이 워커 준비 상태까지 보여주도록 항목을 추가한다.
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
    'failure_count', (select count(*) from sync_failures where not resolved)
  );
$$;

-- --------------------------------------- 5. 버킷 용량 상한 올리기
-- 사진 12장을 합친 PDF 가 10MB 를 넘길 수 있다.
update storage.buckets
   set file_size_limit = 26214400          -- 25MB
 where id = 'exam-papers';
