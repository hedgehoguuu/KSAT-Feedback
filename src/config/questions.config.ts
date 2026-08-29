// ③단계 고민 문항. 문구·개수·타입을 코드 수정 없이 바꾸기 위한 설정 파일. (PRD FE-5)
//
// §9 Q2 — 2026-08-29 서현 작성, 같은 날 정리. 다섯 문항 모두 선택 입력이며 하나도 안 적어도 넘어간다.
// 선택형(탭)은 전부 뺐다. 시험지를 보면 알 수 있는 것을 학생에게 다시 묻지 않기로 했다.

import type { SubjectCode } from './subjects';

export type QuestionType = 'short' | 'long' | 'items';

/** 'items' 문항의 한 줄. 문항 번호와 그 문항이 어려웠던 이유를 함께 받는다. */
export type ConcernItem = { no: string; why: string };

/** 답변 하나가 가질 수 있는 모양. 'items' 문항만 배열이고 나머지는 문자열이다. */
export type ConcernValue = string | ConcernItem[];

export type Question = {
  /** 저장 키. submission_subjects.concerns 의 JSON 키가 된다. 한번 정하면 바꾸지 않는다. */
  id: string;
  type: QuestionType;
  /** 질문 문장. {subject} 는 과목명으로 치환된다. */
  label: string;
  /** 질문 아래 작은 안내 문구 */
  helper?: string;
  placeholder?: string;
  /**
   * Notion 속성 「고민」 한 줄 요약에 쓸 문항 표시.
   * 순서를 바꿔도 요약이 깨지지 않도록 위치가 아니라 이 표시로 찾는다.
   */
  summary?: 'hard';
};

/** 설정 실수로 화면이 끝없이 길어지지 않게 두는 상한. 실제 개수는 아래 배열이 정한다. */
export const QUESTION_SLOTS = 12;

export const CONCERN_QUESTIONS: readonly Question[] = [
  {
    id: 'q3',
    type: 'items',
    summary: 'hard',
    label: '시간을 너무 오래 쓰거나, 풀이 방향이 보이지 않아 현장에서 당황하게 만든 문항 번호를 적어주세요.',
    helper: '왜 어려웠는지도 함께 적어주면 훨씬 정확하게 볼 수 있어요. 여러 개면 하나씩 추가해주세요.',
  },
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
    id: 'q5',
    type: 'long',
    label: '평소 해당 과목에 대해 어느 부분이 가장 개선이 필요하다고 느꼈는지 알려주세요.',
  },
  {
    id: 'q6',
    type: 'long',
    label: '튜터에게 제공하고 싶거나 묻고 싶은 점이 있다면 말해주세요.',
    placeholder: '예) 평균 성적, 목표 성적, 튜터의 공부법',
  },
] as const;

/** 과목별로 다르게 묻고 싶을 때만 채운다. 비어 있으면 위 기본 문항을 쓴다. */
export const CONCERN_QUESTIONS_BY_SUBJECT: Partial<Record<SubjectCode, readonly Question[]>> = {};

export function questionsFor(subject: SubjectCode): readonly Question[] {
  const list = CONCERN_QUESTIONS_BY_SUBJECT[subject] ?? CONCERN_QUESTIONS;
  return list.slice(0, QUESTION_SLOTS);
}

/** 'items' 값을 안전하게 배열로 꺼낸다. 저장된 모양이 달라도 화면이 깨지지 않게. */
export function itemsOf(value: ConcernValue | undefined): ConcernItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v && typeof v === 'object');
}

/** 번호도 이유도 비어 있는 줄은 답한 것으로 치지 않는다. */
function filledItems(value: ConcernValue | undefined): ConcernItem[] {
  return itemsOf(value).filter((it) => (it.no ?? '').trim() || (it.why ?? '').trim());
}

export function isAnswered(question: Question, value: ConcernValue | undefined): boolean {
  if (question.type === 'items') return filledItems(value).length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

/** 저장된 값을 사람이 읽는 글로 바꾼다. Notion 본문과 요약이 함께 쓴다. */
export function answerText(question: Question, value: ConcernValue | undefined): string {
  if (question.type === 'items') {
    return filledItems(value)
      .map((it) => {
        const no = (it.no ?? '').trim();
        const why = (it.why ?? '').trim();
        if (no && why) return `${no} — ${why}`;
        return no || why;
      })
      .join('\n');
  }
  return typeof value === 'string' ? value.trim() : '';
}

/** 요약에 쓸 문항 번호만 뽑는다 — "14번, 22번" */
export function itemNumbers(value: ConcernValue | undefined): string {
  return filledItems(value)
    .map((it) => (it.no ?? '').trim())
    .filter(Boolean)
    .join(', ');
}
