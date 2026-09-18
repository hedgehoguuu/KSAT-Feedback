-- ============================================================================
-- 0018 — 상태가 바뀌는 자리마다 DB 가 한 번 더 본다
--
-- 화면에서는 성공했는데 실제 결과가 어긋나던 자리들이다. 앱이 먼저 확인하더라도, 확인과 쓰기
-- 사이에 다른 요청이 끼어들 수 있는 것은 여기서 같은 잠금 안에서 다시 본다.
--
--   1. 비밀번호를 바꾸면 다른 기기의 로그인이 풀린다 (lms_users.session_key)
--   2. 실패한 접수는 곧바로 다시 집지 않는다 (claim_submission)
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

-- ------------------------------------------- 2. 실패한 접수를 곧바로 다시 집지 않는다
-- 0002 와 같고 한 가지가 다르다: 실패한 접수는 마지막으로 집은 지 10분이 지나야 다시 집는다.
-- 예전에는 가장 오래된 실패를 곧바로 다시 줘서, 빨리 실패하는 접수 하나가 크론 한 판 안에서
-- 자동 재시도 다섯 번을 다 써 버렸다 — 바깥 서비스가 다음 날 살아나도 그 접수는 다시 돌지 않고,
-- 뒤에 밀린 새 접수는 그동안 기다렸다. 이제 크론 한 판에 한 번씩, 닷새에 걸쳐 다시 해 본다.
-- 사람이 번호를 집어 부르면(p_receipt_no) 기다리지 않는다.
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
       status = 'submitted'
       or (status = 'failed'
           and (p_receipt_no is not null or claimed_at is null or claimed_at < now() - interval '10 minutes'))
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

-- 0014 와 같은 이유. 다시 만든 함수도 공개 키로는 못 부르게 한다.
revoke execute on function public.claim_submission(text) from public, anon, authenticated;
grant execute on function public.claim_submission(text) to service_role;

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
