import type { AnswerRow, QuestionRow } from './score';

/**
 * 채점 화면이 그릴 때 본 판 — 정오와 정답표.
 *
 * 저장할 때 이 판을 같이 보내고, DB 가 응시를 잠근 뒤 지금 것과 견준다 (0017 save_grading).
 * 다르면 아무것도 쓰지 않고 STALE 로 멈춘다. 오래 열어 둔 화면으로 저장하면 생기는 두 가지를 막는다.
 *
 *   · 학생이 사진을 바꿔 사진 채점이 비워졌는데, 옛 사진의 점수가 되살아나 공개된다.
 *   · 정답표를 고쳐 다시 매겼는데, 그 전에 열어 둔 화면의 O/X 가 새 채점을 덮는다.
 *
 * 예전(0016)에는 응시의 updated_at 으로 견줬다. 그 값은 학생이 질문을 제출할 때도 올라서,
 * 채점과 상관없는 일로 저장이 거절됐다. 그래서 시각이 아니라 내용을 본다.
 *
 * 순수 계산이라 브라우저 부품(GradeSheet) · 서버 함수 · 시험이 같이 쓴다.
 */
export type GradingSnapshot = {
  answers: AnswerRow[];
  key: { question_id: string; answer: number | null }[];
};

/** 채점 화면이 받은 문항표와 정오로 판을 만든다. 순서는 DB 가 다시 맞춘다. */
export function gradingSnapshot(questions: readonly QuestionRow[], answers: readonly AnswerRow[]): GradingSnapshot {
  return {
    answers: answers.map((a) => ({ question_id: a.question_id, correct: a.correct, chosen: a.chosen })),
    key: questions.map((q) => ({ question_id: q.id, answer: q.answer })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function smallInt(v: unknown): v is number | null {
  return v === null || (Number.isInteger(v) && Math.abs(v as number) < 32_768);
}

/**
 * 폼의 숨은 칸에서 온 판을 읽는다. 모양이 틀리면 null — 부르는 쪽은 null 을 '판 없음' 으로 본다.
 * DB 는 판의 문항 id 를 uuid 로 바꿔 보므로, 여기서 먼저 걸러야 알아볼 수 없는 오류가 안 뜬다.
 */
export function parseSnapshot(raw: string): GradingSnapshot | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { answers, key } = value as { answers?: unknown; key?: unknown };
  if (!Array.isArray(answers) || !Array.isArray(key)) return null;

  const answersOk = answers.every(
    (a) =>
      a && typeof a === 'object' &&
      typeof a.question_id === 'string' && UUID.test(a.question_id) &&
      typeof a.correct === 'boolean' && smallInt(a.chosen),
  );
  const keyOk = key.every(
    (k) => k && typeof k === 'object' && typeof k.question_id === 'string' && UUID.test(k.question_id) && smallInt(k.answer),
  );
  return answersOk && keyOk ? (value as GradingSnapshot) : null;
}

/**
 * 두 판이 어느 문항에서 다른가 — 거절됐을 때 튜터에게 짚어 준다.
 * 정오가 생기거나 사라지거나 바뀐 문항, 정답이 바뀐 문항의 번호를 오름차순으로.
 */
export function changedNos(
  before: GradingSnapshot,
  after: GradingSnapshot,
  questions: readonly Pick<QuestionRow, 'id' | 'no'>[],
): number[] {
  const noOf = new Map(questions.map((q) => [q.id, q.no]));
  const out = new Set<number>();

  const answersBefore = new Map(before.answers.map((a) => [a.question_id, a]));
  const answersAfter = new Map(after.answers.map((a) => [a.question_id, a]));
  for (const id of new Set([...answersBefore.keys(), ...answersAfter.keys()])) {
    const a = answersBefore.get(id);
    const b = answersAfter.get(id);
    if (!a || !b || a.correct !== b.correct || a.chosen !== b.chosen) {
      const no = noOf.get(id);
      if (no !== undefined) out.add(no);
    }
  }

  const keyBefore = new Map(before.key.map((k) => [k.question_id, k.answer]));
  for (const k of after.key) {
    if (keyBefore.get(k.question_id) !== k.answer) {
      const no = noOf.get(k.question_id);
      if (no !== undefined) out.add(no);
    }
  }

  return [...out].sort((x, y) => x - y);
}
