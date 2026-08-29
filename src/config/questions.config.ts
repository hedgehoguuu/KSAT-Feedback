// ③단계 고민 문항. 문구·개수·타입을 코드 수정 없이 바꾸기 위한 설정 파일. (PRD FE-5)
//
// §9 Q2 확정본 — 2026-08-29 서현 작성. 열 문항 모두 선택 입력이며, 하나도 안 적어도 넘어간다.

import type { SubjectCode } from './subjects';

export type QuestionType = 'short' | 'long' | 'choice';

export type Question = {
  /** 저장 키. submission_subjects.concerns 의 JSON 키가 된다. 한번 정하면 바꾸지 않는다. */
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

/** 설정 실수로 화면이 끝없이 길어지지 않게 두는 상한. 실제 개수는 아래 배열이 정한다. */
export const QUESTION_SLOTS = 12;

export const CONCERN_QUESTIONS: readonly Question[] = [
  {
    id: 'q1',
    type: 'long',
    label: '시험 전반에 대한 느낌을 알려주세요.',
    placeholder: '예) 6모에 비해 쉬운 난이도, 대체로 쉽지만 한두 문제만 어려움',
  },
  {
    id: 'q2',
    type: 'long',
    label: '전반적인 시험 운영을 어떻게 했는지 알려주세요.',
    placeholder: '예) 문제 풀이 순서, 시간 분배',
  },
  {
    id: 'q3',
    type: 'short',
    label: '어려움을 느낀 문항 번호를 적어주세요.',
    helper: '여러 개라면 모두 적어주세요.',
    placeholder: '예) 14번, 22번, 30번',
  },
  {
    id: 'q4',
    type: 'long',
    label: '평소 해당 과목을 어떻게 공부하는지 알려주세요.',
    placeholder: '예) 인강 듣고 복습, 기출 위주로 반복',
  },
  {
    id: 'q5',
    type: 'long',
    label: '평소 해당 과목에 대해 어느 부분이 가장 개선이 필요하다고 느꼈는지 알려주세요.',
  },
  {
    id: 'q6',
    type: 'long',
    label: '이외에 튜터에게 제공하고 싶은 정보가 있다면 알려주세요.',
    placeholder: '예) 6모 점수, 평균 성적대, 원하는 성적',
  },
  {
    id: 'q7',
    type: 'long',
    label: '튜터에게 묻고 싶은 점이 있다면 알려주세요.',
    placeholder: '예) 튜터의 공부법, 자투리 시간 활용법',
  },
  {
    id: 'q8',
    type: 'choice',
    label: '시간은 어땠어요?',
    options: [
      { value: 'tight', label: '아슬아슬했어요' },
      { value: 'short', label: '많이 부족했어요' },
      { value: 'enough', label: '충분했어요' },
    ],
  },
  {
    id: 'q9',
    type: 'choice',
    label: '찍은 문제가 있었나요?',
    options: [
      { value: 'none', label: '없어요' },
      { value: 'few', label: '한두 개 있어요' },
      { value: 'many', label: '많았어요' },
    ],
  },
  {
    id: 'q10',
    type: 'choice',
    label: '피드백으로 가장 받아보고 싶은 점이 무엇인가요?',
    options: [
      { value: 'diagnose', label: '문제점 파악' },
      { value: 'direction', label: '개선 방향 제시' },
      { value: 'routine', label: '공부 루틴 점검' },
      { value: 'etc', label: '기타' },
    ],
  },
] as const;

/** 과목별로 다르게 묻고 싶을 때만 채운다. 비어 있으면 위 기본 문항을 쓴다. */
export const CONCERN_QUESTIONS_BY_SUBJECT: Partial<Record<SubjectCode, readonly Question[]>> = {};

export function questionsFor(subject: SubjectCode): readonly Question[] {
  const list = CONCERN_QUESTIONS_BY_SUBJECT[subject] ?? CONCERN_QUESTIONS;
  return list.slice(0, QUESTION_SLOTS);
}

/** 선택지 값(diagnose)이 아니라 사람이 읽는 말(개선 방향 제시)로 바꾼다. */
export function answerText(question: Question, raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (question.type !== 'choice') return value;
  return question.options?.find((o) => o.value === value)?.label ?? value;
}
