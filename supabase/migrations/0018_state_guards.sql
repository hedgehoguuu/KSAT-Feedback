-- ============================================================================
-- 0018 — 상태가 바뀌는 자리마다 DB 가 한 번 더 본다
--
-- 화면에서는 성공했는데 실제 결과가 어긋나던 자리들이다. 앱이 먼저 확인하더라도, 확인과 쓰기
-- 사이에 다른 요청이 끼어들 수 있는 것은 여기서 같은 잠금 안에서 다시 본다.
--
--   1. 비밀번호를 바꾸면 다른 기기의 로그인이 풀린다 (lms_users.session_key)
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
