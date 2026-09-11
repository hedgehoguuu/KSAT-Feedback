-- ============================================================================
-- 0014 — 서버 전용 함수를 서버 키로만 부를 수 있게
--
-- 이 앱의 DB 함수는 전부 서버가 service_role 키로 부른다. 그런데 Postgres 는 함수를 만들면
-- 실행 권한을 PUBLIC 에 주고, Supabase 는 거기에 anon · authenticated 까지 기본으로 준다.
-- 그러면 공개 키(anon)만 있으면 /rest/v1/rpc/... 로 이 함수들을 직접 부를 수 있다.
--
-- 대부분 security definer 라 표의 RLS 도 안 먹는다. 예를 들어
--   save_grading              — 응시 id 만 알면 채점을 통째로 덮어쓴다
--   create_class_application  — 동의·형식 검사 없이 신청을 끼워 넣는다
--   claim_submission          — 처리 중인 접수를 가로챈다
--   setup_status              — 접수·신청 건수가 새어 나간다
--
-- 앱은 공개 키를 브라우저로 내보내지 않지만, 키가 새는 날 문이 열려 있으면 안 된다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- 아직 안 돌린 번호의 함수가 있어도 멈추지 않고 있는 것만 잠근다.
-- ============================================================================

-- --------------------------------------------------------------- 설치 점검
-- 0013 의 것을 그대로 두고 'rpc_locked' 한 줄만 더한다.
-- 여기서 빠뜨리면 /setup 의 '서버 전용 함수 잠금' 이 빨간불이 된다.
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
    -- 0014 가 넣은 검사. 서버 전용 함수 중 공개 키로 부를 수 있는 것이 하나도 없어야 참.
    -- 이름으로 찾으므로 아직 안 만든 함수는 그냥 건너뛴다.
    'rpc_locked', not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'create_submission', 'next_receipt_no', 'today_receipt_count', 'claim_submission',
           'setup_status', 'create_class_application', 'purge_expired_applications', 'save_grading'
         )
         and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
    )
  );
$$;

-- ------------------------------------------------------------- 실행 권한 회수
-- PUBLIC 까지 거둬야 한다. anon 에서만 빼면 PUBLIC 을 거쳐 여전히 부를 수 있다.
-- service_role 에는 다시 준다 — 앱이 쓰는 키다.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_submission(jsonb)',
    'next_receipt_no(timestamptz)',
    'today_receipt_count()',
    'claim_submission(text)',
    'setup_status()',
    'create_class_application(jsonb)',
    'purge_expired_applications()',
    'save_grading(jsonb)'
  ]
  loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end $$;

-- 앞으로 만들 함수도 처음부터 닫아 둔다. 다음 마이그레이션이 이 파일을 잊어도 새 함수가
-- 공개 키로 열리지 않게. service_role 의 기본 권한은 그대로라 앱은 영향이 없다.
-- (create or replace 로 다시 만든 함수는 원래 권한을 유지하므로 위의 회수가 그대로 남는다.)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
