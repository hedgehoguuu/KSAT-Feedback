-- ============================================================================
-- 0009 — 로그인 아이디는 소문자만 (0008 의 뒤처리)
--
-- 0008 은 중복을 lower(login_id) 유니크 인덱스로 막았다. 그래서 'Boss' 와 'boss' 가
-- 함께 있을 수는 없다. 그런데 대문자가 섞인 줄이 **하나만** 있는 것은 못 막았다.
--
-- 앱은 로그인할 때 적어 준 아이디를 소문자로 내려서 `login_id = ?` 로 찾는다
-- (src/lib/lms/auth.ts · users.ts). 그러니 Supabase Table Editor 로 'Kim.Seo' 를
-- 직접 넣으면 그 계정은 영영 로그인이 안 되고, 화면에는 '아이디나 비밀번호가 달라요'
-- 만 뜬다 — 무엇이 잘못됐는지 아무도 알 수 없는 종류의 고장이다.
--
-- 찾는 쪽을 대소문자 무시로 바꾸지 않은 이유: ilike 는 `_` 와 `%` 를 자리표로 읽는다.
-- 아이디에 `_` 를 허용하고 있어서(a_b) 엉뚱한 계정(axb)이 걸릴 수 있다.
-- 넣는 쪽을 막는 편이 규칙이 하나로 끝난다.
--
-- Supabase → SQL Editor 에 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- 이미 들어가 있는 대문자 아이디를 먼저 내린다. 아래 검사를 걸기 전에 해야 한다.
-- 소문자로 내렸을 때 서로 부딪히는 짝은 0008 의 유니크 인덱스가 이미 막아 뒀으므로 없다.
update lms_users set login_id = lower(login_id) where login_id <> lower(login_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lms_users_login_id_lower'
  ) then
    alter table lms_users
      add constraint lms_users_login_id_lower check (login_id = lower(login_id));
  end if;
end $$;
