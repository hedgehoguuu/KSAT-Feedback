-- ============================================================================
-- 0007 — 같은 번호로 두 번 신청되지 않게
--
-- 정원이 3명이다. 새로고침 뒤 한 번 더 누르거나, 부모와 학생이 각각 신청하면
-- 자리 하나가 헛되이 없어진다. 세 자리 중 하나다.
--
-- 막는 대신 '이미 넣으셨어요' 로 끝낸다 — 오류를 띄우면 학생은 신청이 안 된 줄 알고
-- 다시 누른다. 같은 반에 같은 번호의 살아 있는 신청이 있으면 그 신청을 그대로 돌려준다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- 번호로 빨리 찾기 위한 색인. 취소된 것은 자리를 돌려줬으므로 다시 신청할 수 있다.
create index if not exists class_applications_phone_idx
  on class_applications (class_id, parent_phone)
  where status <> 'canceled';

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
  dup    uuid;
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

  -- 이미 넣은 번호면 그 신청을 그대로 돌려준다. 자리를 또 쓰지 않는다.
  -- 반 행을 잠근 뒤에 보므로, 같은 번호가 동시에 두 번 들어와도 하나만 만들어진다.
  select id into dup
    from class_applications
   where class_id = cid
     and parent_phone = payload->>'parent_phone'
     and status <> 'canceled'
   limit 1;

  if dup is not null then
    return dup;
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
