import type { ExamCode } from '@/config/exams';
import { findExam } from '@/config/exams';
import type { SubjectCode } from '@/config/subjects';
import type { Photo } from './store';

/**
 * 고민 입력·제출 대상 과목. 사진이 실제로 올라간 과목만, 시험에 정의된 순서로 돌려준다.
 * ③단계 진행 순서와 제출 페이로드가 같은 순서를 쓰도록 한곳에서 계산한다.
 */
export function filledSubjects(
  examCode: ExamCode | null,
  selected: SubjectCode[],
  photos: Photo[],
): SubjectCode[] {
  const exam = findExam(examCode);
  if (!exam) return [];
  return exam.subjects.filter(
    (code) =>
      selected.includes(code) &&
      photos.some((p) => p.subject === code && p.status === 'done'),
  );
}
