-- ============================================================================
-- 0006 — 반마다 어떤 모의고사를 쓰는지
--
-- 카드에 "모의고사 — 이감 파이널 모의고사" 한 줄이 생긴다. 값은 /admin 에서 고친다.
-- 과목이 늘면 반마다 다른 모의고사를 쓰게 되므로 문구가 아니라 열로 둔다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

alter table classes add column if not exists mock_exam text;

-- 이미 만들어 둔 국어 반은 지금 쓰는 것으로 채워 준다. 비어 있는 것만 건드린다 —
-- 관리자가 이미 다른 값을 넣었다면 그대로 둔다.
update classes
   set mock_exam = '이감 파이널 모의고사'
 where mock_exam is null
   and subject_code = 'korean';

-- 설치 점검에 노출
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
    'open_class_count', (select count(*) from classes where status = 'open'),
    'application_count', (select count(*) from class_applications where status <> 'canceled')
  );
$$;
