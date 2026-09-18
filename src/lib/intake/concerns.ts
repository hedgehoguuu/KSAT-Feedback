// ③단계 고민 답변 값 읽기. 문항 타입마다 저장되는 모양이 달라서(글 · {번호, 이유} 목록 · 보기)
// 화면 · 제출 · Notion 본문이 모두 이 함수들로 꺼낸다. 문항 자체는 config/questions.config.ts 에 있다.

import type { ChoiceAnswer, ConcernItem, ConcernValue, Question } from '@/config/questions.config';

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
