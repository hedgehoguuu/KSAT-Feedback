-- ============================================================================
-- 0019 — 신청이 새로 들어갔는지, 이미 있던 것인지, 막혔는지를 가려 돌려준다
--
-- 0007 은 같은 반에 같은 학부모 번호의 살아 있는 신청이 있으면 그 신청의 id 를 돌려줬다.
-- 같은 학생의 재시도라면 맞다. 그런데 같은 번호로 **다른 학생**이 신청해도 앞 학생의 id 가 나갔고,
-- 앱은 그것을 새 신청으로 알아 성공 화면과 알림 메일을 보냈다 — 새 학생은 명단에 없는데.
--
-- 이제 셋을 가른다.
--   새 신청        앱이 미리 뽑아 넘긴 id(payload.id)로 만들고 그 id 를 돌려준다
--   같은 신청 재시도  같은 번호 · 같은 이름의 살아 있는 신청 id 를 돌려준다 — 넘긴 id 와 다르다
--   다른 학생       같은 번호에 이름이 다른 살아 있는 신청이 있으면 PHONE_TAKEN 으로 멈춘다
-- 앱은 돌려받은 id 가 넘긴 것과 같을 때만 새 신청으로 보고 알림을 보낸다 (lib/class/classes.ts).
--
-- 다른 학생을 받지 않고 막는 이유는 0007 과 같다. 부모와 학생이 이름을 조금 달리 적어 각각
-- 신청하면 세 자리 중 하나가 헛되이 없어진다. 한 번호에 한 자리 — 관리자가 취소한 신청을 되살릴
-- 때도 같은 규칙이다 (0018 set_application_status). 형제 · 자매는 연락받을 때 사람이 받는다.
--
-- 시그니처와 돌려주는 타입은 그대로다. 지금 돌고 있는 앱(id 를 안 넘기는 0018 판)도 그대로 돈다 —
-- id 가 없으면 DB 가 뽑는다. 다른 학생이면 그 앱에는 '신청이 안 됐어요' 가 뜬다.
-- 먼저 돌리고 배포한다. 새 앱이 이 파일 없이 돌면 새 신청도 '이미 있던 것' 으로 보여 알림이 안 간다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

create or replace function create_class_application(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid      uuid;
  cap      int;
  taken    int;
  dup      uuid;
  dup_name text;
  new_id   uuid;
begin
  select id, capacity into cid, cap
    from classes
   where slug = payload->>'slug'
     and status = 'open'
   for update;

  if cid is null then
    raise exception 'CLASS_NOT_OPEN' using errcode = 'P0001', hint = '지금 신청을 받고 있지 않은 반이에요';
  end if;

  -- 같은 번호의 살아 있는 신청. 반 행을 잠근 뒤에 보므로 같은 번호가 동시에 두 번 들어와도
  -- 하나만 만들어진다. 이름이 같은 것이 있으면 그것을 먼저 본다 — 재시도를 막지 않게.
  select id, student_name into dup, dup_name
    from class_applications
   where class_id = cid
     and parent_phone = payload->>'parent_phone'
     and status <> 'canceled'
   order by (student_name = payload->>'student_name') desc, created_at
   limit 1;

  if dup is not null then
    if dup_name = payload->>'student_name' then
      return dup;
    end if;
    raise exception 'PHONE_TAKEN' using errcode = 'P0001', hint = '같은 연락처로 다른 학생의 신청이 있어요';
  end if;

  select count(*) into taken
    from class_applications
   where class_id = cid
     and status <> 'canceled';

  if taken >= cap then
    raise exception 'CLASS_FULL' using errcode = 'P0001', hint = '자리가 다 찼어요';
  end if;

  insert into class_applications
    (id, class_id, student_name, receipt_no, parent_phone, consent_at, purge_after)
  values (
    coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()),
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

-- 0014 와 같은 이유. 다시 만든 함수도 공개 키로는 못 부르게 한다.
revoke execute on function public.create_class_application(jsonb) from public, anon, authenticated;
grant execute on function public.create_class_application(jsonb) to service_role;

-- ------------------------------------------------------ 돌린 파일 적어 두기
-- /setup 이 이 표를 읽어 빠진 마이그레이션을 짚는다 (lib/health.ts 의 REQUIRED_MIGRATIONS).
-- 표는 0017 이 만든다. 0017 을 건너뛰고 돌려도 여기서 멈추지 않게 한 번 더 적는다.
create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;

insert into schema_migrations (name) values ('0019_apply_outcome')
  on conflict (name) do update set applied_at = excluded.applied_at;
