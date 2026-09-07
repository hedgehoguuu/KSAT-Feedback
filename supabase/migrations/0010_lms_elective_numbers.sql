-- ============================================================================
-- 0010 — 선택과목은 같은 번호를 쓴다 (0008 의 잘못된 제약을 고침)
--
-- 0008 은 회차 안에서 문항 번호가 하나뿐이도록 막았다(unique (exam_id, no)).
-- 그런데 국어 시험지에서 35~45번은 화작 학생과 언매 학생이 **같은 번호로 서로 다른
-- 문항**을 푼다. 두 벌을 다 등록해야 하는데 그 제약이 막고 있었다.
--
-- 더 나쁜 것은 조용히 실패했다는 점이다 — 앱이 저장할 때 번호로만 중복을 걸러서
-- 두 번째 벌(언매)이 아무 말 없이 버려지고, 그 반의 언매 학생은 선택과목 11문항이
-- 통째로 '아직 안 매김' 으로 남았다. 화면 어디에도 그런 말이 없다.
--
-- 번호 + 영역으로 묶는다. 같은 번호라도 영역이 다르면 다른 문항이고,
-- 같은 번호에 같은 영역이 두 줄인 것은 여전히 실수이므로 그대로 막는다.
--
-- Supabase → SQL Editor 에 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- 0008 이 unique (exam_id, no) 로 만든 제약. 이름은 Postgres 가 붙인 기본 이름이다.
alter table lms_exam_questions drop constraint if exists lms_exam_questions_exam_id_no_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lms_exam_questions_exam_no_area_key'
  ) then
    alter table lms_exam_questions
      add constraint lms_exam_questions_exam_no_area_key unique (exam_id, no, area_code);
  end if;
end $$;
