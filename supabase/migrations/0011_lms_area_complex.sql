-- ============================================================================
-- 0011 — 현대시 자리를 갈래복합으로
--
-- 요즘 국어 시험지의 문학 첫 세트는 시 하나만 나오는 일이 드물다. (가)(나) 로
-- 갈래가 섞여 나오는 쪽이 보통이라, 영역 목록에서 현대시 한 칸을 갈래복합으로 바꿨다.
--
-- 이름만 바꾸지 않고 코드까지 바꾸는 이유: 코드는 그대로 두고 이름표만 갈면 DB 에는
-- lit_modern_poem 이 남아서, 나중에 이 표를 직접 들여다보는 사람이 '현대시' 를 보게 된다.
-- 화면에 보이는 말과 저장된 말이 다르면 언젠가 반드시 헷갈린다.
--
-- 그래서 이미 저장된 문항과 코멘트를 함께 옮긴다. 옮기지 않으면 그 문항들은 목록에 없는
-- 코드를 달고 남아 — 채점에서 통째로 빠지고 화면에도 안 나온다.
--
-- Supabase → SQL Editor 에 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- 문항표. (exam_id, no, area_code) 가 유일하므로, 한 회차에 현대시와 갈래복합이
-- 같은 번호로 함께 있으면 옮길 때 부딪힌다 — 그런 줄은 건드리지 않고 남긴다.
update lms_exam_questions q
   set area_code = 'lit_complex'
 where area_code = 'lit_modern_poem'
   and not exists (
     select 1 from lms_exam_questions o
      where o.exam_id = q.exam_id and o.no = q.no and o.area_code = 'lit_complex'
   );

-- 영역 코멘트. (attempt_id, area_code) 가 기본키라 같은 이유로 부딪힐 수 있다.
update lms_area_comments c
   set area_code = 'lit_complex'
 where area_code = 'lit_modern_poem'
   and not exists (
     select 1 from lms_area_comments o
      where o.attempt_id = c.attempt_id and o.area_code = 'lit_complex'
   );

-- 옮기지 못하고 남은 것이 있으면 알려 준다. 실행 결과 창에 뜬다.
do $$
declare left_q int; left_c int;
begin
  select count(*) into left_q from lms_exam_questions where area_code = 'lit_modern_poem';
  select count(*) into left_c from lms_area_comments  where area_code = 'lit_modern_poem';
  if left_q + left_c > 0 then
    raise notice '옮기지 못한 줄이 있습니다 — 문항 %개, 코멘트 %개. 같은 번호에 갈래복합이 이미 있어서입니다. 문항표 화면에서 직접 정리해주세요.', left_q, left_c;
  else
    raise notice '현대시로 저장된 줄을 모두 갈래복합으로 옮겼습니다.';
  end if;
end $$;
