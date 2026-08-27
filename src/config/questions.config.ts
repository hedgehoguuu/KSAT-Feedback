// ③단계 고민 문항. 문구·개수·타입을 코드 수정 없이 바꾸기 위한 설정 파일. (PRD FE-5)
//
// 주의: 아래 문구는 잠정안이다. 최종 문구는 §9 Q2(서현, 8/30까지) 확정 후 이 파일만 고친다.

import type { SubjectCode } from './subjects';

export type QuestionType = 'short' | 'long' | 'choice';

export type Question = {
  /** 저장 키. submission_subjects.concerns 의 JSON 키가 된다. */
  id: string;
  type: QuestionType;
  /** 질문 문장. {subject} 는 과목명으로 치환된다. */
  label: string;
  /** 질문 아래 작은 안내 문구 */
  helper?: string;
  placeholder?: string;
  /** type === 'choice' 일 때만 사용 */
  options?: readonly { value: string; label: string }[];
};

/** ③단계가 확보하는 문항 자리 수. 이보다 많이 정의해도 앞에서부터 이 개수만 렌더링한다. */
export const QUESTION_SLOTS = 5;

/** v1 기본값: 5문항 모두 선택 입력(필수 아님). */
export const CONCERN_QUESTIONS: readonly Question[] = [
  {
    id: 'q1',
    type: 'long',
    label: '{subject}, 어디가 제일 답답했어요?',
    placeholder: '예) 뒤로 갈수록 시간이 모자랐어요',
  },
  {
    id: 'q2',
    type: 'short',
    label: '가장 오래 붙잡았던 문제는 몇 번이었어요?',
    placeholder: '예) 14번, 22번',
  },
  {
    id: 'q3',
    type: 'choice',
    label: '시간은 어땠어요?',
    options: [
      { value: 'short', label: '많이 모자랐어요' },
      { value: 'tight', label: '아슬아슬했어요' },
      { value: 'enough', label: '충분했어요' },
    ],
  },
  {
    id: 'q4',
    type: 'choice',
    label: '찍은 문제가 있어요?',
    options: [
      { value: 'none', label: '없어요' },
      { value: 'few', label: '한두 개요' },
      { value: 'many', label: '꽤 많아요' },
    ],
  },
  {
    id: 'q5',
    type: 'long',
    label: '이번 시험 보고 나서 제일 궁금한 게 뭐예요?',
    placeholder: '예) 왜 자꾸 같은 유형에서 틀리는지 모르겠어요',
  },
] as const;

/** 과목별로 다르게 묻고 싶을 때만 채운다. 비어 있으면 위 기본 문항을 쓴다. */
export const CONCERN_QUESTIONS_BY_SUBJECT: Partial<Record<SubjectCode, readonly Question[]>> = {};

export function questionsFor(subject: SubjectCode): readonly Question[] {
  const list = CONCERN_QUESTIONS_BY_SUBJECT[subject] ?? CONCERN_QUESTIONS;
  return list.slice(0, QUESTION_SLOTS);
}
