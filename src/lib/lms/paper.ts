// 시험지 번호의 규칙 — 그 번호에 어떤 답이 올 수 있는가, 어떤 단원을 붙일 수 있는가,
// 질문을 어느 자리에 달 수 있는가. 표(config/lms.ts 의 PAPER · UNITS)를 읽어 판단만 한다.
//
// 순수 계산이라 브라우저 부품 · 서버 함수 · 시험이 같이 부른다. 화면과 서버가 같은 함수를 봐야
// 화면은 받아 주는데 서버가 거절하는 일이 없다.

import {
  ANSWER_RANGE,
  CONCERN,
  QUESTION_COUNT,
  UNITS,
  isQuestionNo,
  paperQuestion,
  sectionOf,
  type Unit,
} from '@/config/lms';

/* ─────────────────────────────────────────────────────────── 답 */

/** 이 번호에 이 값이 답으로 올 수 있는가. 정답표 · 학생 답 · 사진에서 읽은 값을 모두 여기서 거른다. */
export function isValidAnswer(no: number, value: unknown): value is number {
  const q = paperQuestion(no);
  if (!q || typeof value !== 'number' || !Number.isInteger(value)) return false;
  const { min, max } = ANSWER_RANGE[q.kind];
  return value >= min && value <= max;
}

/**
 * 폼에서 온 글자를 답으로. 비었거나 맞지 않으면 null.
 * "③" · "3번" 처럼 적어도 받는다 — 동그라미 숫자는 5지선다를 적을 때 흔히 나온다.
 */
export function parseAnswer(no: number, raw: string | null | undefined): number | null {
  const text = String(raw ?? '')
    .trim()
    .replace(/[①②③④⑤]/g, (c) => String('①②③④⑤'.indexOf(c) + 1))
    .replace(/번$/, '');
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return isValidAnswer(no, value) ? value : null;
}

/** 답을 화면에 적는 모양. 5지선다는 동그라미 숫자로 — 단답형 3 과 5지선다 ③ 이 헷갈리지 않게. */
export function fmtAnswer(no: number, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (paperQuestion(no)?.kind === 'choice' && value >= 1 && value <= 5) return '①②③④⑤'[value - 1];
  return String(value);
}

/* ─────────────────────────────────────────────────────────── 단원 */

/** 이 번호에 붙일 수 있는 단원. 공통 문항에 미적분 단원을 붙이면 집계가 어긋난다. */
export function unitsFor(no: number): Unit[] {
  const calculus = sectionOf(no) === 'calculus';
  return UNITS.filter((u) => (u.group === 'calculus') === calculus);
}

export function unitFits(no: number, code: string | null | undefined): boolean {
  return Boolean(code) && unitsFor(no).some((u) => u.code === code);
}

/* ─────────────────────────────────────────────────────── 질문 자리 */

/** 질문을 달 수 있는 자리인가 — 문항 번호이거나 '시험 전체'. */
export function isConcernTopic(no: number): boolean {
  return no === CONCERN.wholeExam || isQuestionNo(no);
}

/** 질문을 늘어놓는 순서. 문항 순서대로, '시험 전체' 는 맨 뒤. */
export function concernOrder(a: number, b: number): number {
  const key = (n: number) => (n === CONCERN.wholeExam ? QUESTION_COUNT + 1 : n);
  return key(a) - key(b);
}
