// ③단계 고민 문항. 문구·개수·타입을 코드 수정 없이 바꾸기 위한 설정 파일. (PRD FE-5)
//
// §9 Q2 — 2026-08-29 서현 작성, 같은 날 정리. 모든 문항이 선택 입력이며 하나도 안 적어도 넘어간다.
// 2026-08-30 — 국어만 문항을 따로 받는다. 국어는 지문·영역별로 물어볼 것이 달라서
// 공통 문항으로는 필요한 정보가 안 나온다. 나머지 과목은 공통 문항 그대로 간다.

import type { SubjectCode } from './subjects';

export type QuestionType = 'short' | 'long' | 'items' | 'choice';

/** 'items' 문항의 한 줄. 문항 번호와 그 문항이 어려웠던 이유를 함께 받는다. */
export type ConcernItem = { no: string; why: string };

/** 'choice' 문항의 답. 보기 하나를 고르고, 문항에 따라 이유를 덧붙인다. */
export type ChoiceAnswer = { choice: string; note?: string };

/** 답변 하나가 가질 수 있는 모양. 문항 타입에 따라 셋 중 하나다. */
export type ConcernValue = string | ConcernItem[] | ChoiceAnswer;

export type Question = {
  /** 저장 키. submission_subjects.concerns 의 JSON 키가 된다. 한번 정하면 바꾸지 않는다. */
  id: string;
  type: QuestionType;
  /** 질문 문장. {subject} 는 과목명으로 치환된다. */
  label: string;
  /** 질문 아래 작은 안내 문구 */
  helper?: string;
  placeholder?: string;
  /** 'choice' 문항의 보기 */
  options?: readonly string[];
  /** 'choice' 문항에서 보기 아래 자유 서술 칸을 열 때. 문구가 placeholder 가 된다. */
  note?: string;
  /**
   * Notion 속성 「고민」 한 줄 요약에 쓸 문항 표시.
   * 순서를 바꿔도 요약이 깨지지 않도록 위치가 아니라 이 표시로 찾는다.
   */
  summary?: 'hard';
};

/** 설정 실수로 화면이 끝없이 길어지지 않게 두는 상한. 실제 개수는 아래 배열이 정한다. */
export const QUESTION_SLOTS = 12;

/** 국어를 제외한 모든 과목이 쓰는 문항 */
export const CONCERN_QUESTIONS: readonly Question[] = [
  {
    id: 'q3',
    type: 'items',
    summary: 'hard',
    label: '시간을 너무 오래 쓰거나, 풀이 방향이 보이지 않아 현장에서 당황하게 만든 문항 번호를 적어주세요.',
    helper: '왜 어려웠는지도 함께 적어주면 훨씬 정확하게 볼 수 있어요. 여러 개면 하나씩 추가해주세요.',
    placeholder: '예) 14번',
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

/**
 * 국어 전용 문항 (2026-08-30).
 * id 는 국어끼리만 쓰므로 공통 문항의 q1·q2 와 겹치지 않게 k 로 시작한다.
 */
const KOREAN_QUESTIONS: readonly Question[] = [
  {
    id: 'k1',
    type: 'short',
    label: '평소 국어 성적은 어느 정도였는지 적어주세요.',
    placeholder: '예) 2-3등급 왔다갔다해요',
  },
  {
    id: 'k2',
    type: 'choice',
    label: '시험 중 시간이 부족했나요?',
    options: [
      '시간이 남았다',
      '거의 딱 맞게 끝냈다',
      '조금 부족했다',
      '많이 부족했다',
      '아예 풀지 못한 문제나 지문이 있었다',
    ],
  },
  {
    id: 'k3',
    type: 'items',
    summary: 'hard',
    label: '시간을 너무 오래 쓰거나, 풀이 방향이 보이지 않아 현장에서 당황하게 만든 문항 번호를 적어주세요.',
    helper: '왜 어려웠는지도 함께 적어주면 훨씬 정확하게 볼 수 있어요. 여러 개면 하나씩 추가해주세요.',
    placeholder: '예) 3페이지 독서지문, 7번',
  },
  {
    id: 'k4',
    type: 'choice',
    label: '평소 가장 어려움을 느낀 영역은 무엇이고 어떤 어려움을 느끼나요?',
    options: ['독서', '문학', '선택'],
    note: '어떤 어려움을 느끼는지도 적어주세요',
  },
  {
    id: 'k5',
    type: 'long',
    label: '현재 국어를 어떠한 방식으로 공부하고 있나요?',
  },
  {
    id: 'k6',
    type: 'long',
    label: '평소 국어 공부에서 가장 고민되는 점은 무엇인가요?',
  },
  {
    id: 'k7',
    type: 'long',
    label: '이번 피드백을 통해 가장 알고 싶은 것은 무엇인가요?',
    placeholder: '예) 시험 운영 방법, EBS 회독 횟수',
  },
  {
    id: 'k8',
    type: 'long',
    label: '위 질문에 상세한 답을 위해, 튜터에게 제공하고 싶은 정보가 있다면 알려주세요.',
    placeholder: '예) 평소 문제풀이 방식이나 습관, 하루 공부시간, 목표 등급',
  },
] as const;

/** 과목별로 다르게 묻고 싶을 때만 채운다. 비어 있으면 위 기본 문항을 쓴다. */
export const CONCERN_QUESTIONS_BY_SUBJECT: Partial<Record<SubjectCode, readonly Question[]>> = {
  korean: KOREAN_QUESTIONS,
};

export function questionsFor(subject: SubjectCode): readonly Question[] {
  const list = CONCERN_QUESTIONS_BY_SUBJECT[subject] ?? CONCERN_QUESTIONS;
  return list.slice(0, QUESTION_SLOTS);
}

/** 'items' 값을 안전하게 배열로 꺼낸다. 저장된 모양이 달라도 화면이 깨지지 않게. */
export function itemsOf(value: ConcernValue | undefined): ConcernItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v && typeof v === 'object');
}

/** 'choice' 값을 안전하게 꺼낸다. */
export function choiceOf(value: ConcernValue | undefined): ChoiceAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { choice: '' };
  return { choice: value.choice ?? '', note: value.note };
}

/** 번호도 이유도 비어 있는 줄은 답한 것으로 치지 않는다. */
function filledItems(value: ConcernValue | undefined): ConcernItem[] {
  return itemsOf(value).filter((it) => (it.no ?? '').trim() || (it.why ?? '').trim());
}

export function isAnswered(question: Question, value: ConcernValue | undefined): boolean {
  if (question.type === 'items') return filledItems(value).length > 0;
  if (question.type === 'choice') {
    const { choice, note } = choiceOf(value);
    return choice.trim().length > 0 || (note ?? '').trim().length > 0;
  }
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

  if (question.type === 'choice') {
    const { choice, note } = choiceOf(value);
    const picked = choice.trim();
    const extra = (note ?? '').trim();
    if (picked && extra) return `${picked} — ${extra}`;
    return picked || extra;
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
