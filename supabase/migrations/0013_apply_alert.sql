-- ============================================================================
-- 0013 — 신청 알림 메일이 갔는지 신청 행에 적어 둔다
--
-- 지금까지 알림 메일이 실패하면 서버 로그에만 한 줄 남았다. 신청은 데이터베이스에
-- 멀쩡히 들어와 있는데 메일이 안 오니, 아무도 그 신청이 있는 줄 모르는 상태가 된다.
-- "메일이 안 왔으니 신청도 없겠지" 가 가장 비싼 오해다.
--
-- 그래서 결과를 신청 행 옆에 적는다. 실패를 sync_failures 에 넣지 않는 이유는,
-- 그 표는 다시 처리해서 resolved 로 닫는 것들이 사는 곳이기 때문이다. 알림 메일은
-- 다시 보내는 길이 없어서 영영 안 닫히는 행이 되고, /setup 이 계속 빨간불이 된다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

alter table class_applications add column if not exists alert_sent_at timestamptz;
alter table class_applications add column if not exists alert_error   text;

-- 이 줄을 돌리기 전에 들어온 신청은 갔는지 안 갔는지 알 수 없다. 둘 다 비워 두고
-- 화면에서는 '모름' 으로 다룬다 — 안 갔다고 단정하면 없는 사고를 만든다.

-- --------------------------------------------------------------- 설치 점검
-- 0006 의 것을 그대로 두고 'apply_alert' 한 줄만 더한다.
-- 여기서 빠뜨리면 /setup 의 '신청 알림 기록' 이 빨간불이 된다.
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
    -- 알림이 실패했는데 아직 아무도 손대지 않은 신청.
    --
    -- 'new' 만 센다. 다시 보내는 길이 없어서, 따로 '확인함' 표시를 만들면 상태가 하나
    -- 더 는다. 사람이 신청자 목록에서 '연락함' 으로 옮기는 순간 이미 본 것이므로,
    -- 그때 경고도 같이 사라지게 둔다. 안 그러면 /setup 이 영영 빨간불로 남는다.
    'alert_failed_count', (
      select count(*) from class_applications
       where alert_error is not null and status = 'new'
    )
  );
$$;
