-- ============================================================================
-- 0012 — 채점 저장을 한 덩어리로 (조용한 데이터 손실 막기)
--
-- 채점 저장은 네 번의 요청으로 나뉘어 있었다.
--   1) 이 응시의 정오를 전부 지운다
--   2) 새 정오를 넣는다
--   3) 영역 코멘트를 지우고 다시 넣는다
--   4) 응시에 총평·공개상태를 적는다
--
-- 2번이 실패하면 1번은 이미 끝나 있다. 그러면 매겨 둔 채점이 통째로 사라지는데,
-- 앱은 그 실패를 확인하지 않아서 화면은 '저장했어요' 라고 말한다.
-- 튜터가 십 분을 들여 매긴 것이 아무 말 없이 없어지는 자리였다.
--
-- 실제로 재현했다: 82점 · 정오 45개 → 0점 · 0개, 예외 없음.
--
-- plpgsql 함수는 통째로 한 트랜잭션이라 중간에 실패하면 전부 되돌아간다.
-- 이 프로젝트는 정원 초과를 막을 때 이미 같은 방법을 썼다 (0005 create_class_application).
--
-- Supabase → SQL Editor 에 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

create or replace function save_grading(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid := (payload->>'attempt_id')::uuid;
begin
  if aid is null then
    raise exception 'attempt_id 가 없습니다';
  end if;

  -- 정오. 지우고 다시 넣는다 — 한 문항씩 맞춰 넣으면 '아까는 O 였는데 지금은 안 매김'
  -- 을 지우는 것을 빠뜨리기 쉽다. 이제 이 delete 와 insert 가 같은 트랜잭션 안에 있다.
  delete from lms_answers where attempt_id = aid;

  insert into lms_answers (attempt_id, question_id, correct, chosen)
  select aid,
         (a->>'question_id')::uuid,
         (a->>'correct')::boolean,
         nullif(a->>'chosen', '')::smallint
    from jsonb_array_elements(coalesce(payload->'answers', '[]'::jsonb)) a;

  delete from lms_area_comments where attempt_id = aid;

  insert into lms_area_comments (attempt_id, area_code, comment)
  select aid, c->>'area_code', c->>'comment'
    from jsonb_array_elements(coalesce(payload->'comments', '[]'::jsonb)) c;

  update lms_attempts
     set elective        = nullif(payload->>'elective', ''),
         overall_comment = payload->>'overall_comment',
         status          = coalesce(payload->>'status', status),
         updated_at      = now()
   where id = aid;

  -- 없는 응시에 저장하려 하면 위 update 가 0행이다. 조용히 넘어가면 안 된다.
  if not found then
    raise exception '없는 응시입니다: %', aid;
  end if;
end;
$$;
