import { PAPER, isQuestionNo, isValidAnswer, unitFits } from '@/config/lms';

/**
 * 모델이 준 것을 우리 표 모양으로 다듬는 부분.
 *
 * 실제로 부르는 쪽(ocr.ts)과 떼어 뒀다. 거기는 API 키가 있어야 돌지만 여기는 순수 계산이라,
 * 키 없이도 그대로 불러 확인할 수 있다. 그리고 여기가 진짜 방어선이다 —
 * 구조화 출력이 보장하는 것은 키와 자료형까지고, 값이 범위 안에 있는지는 여기서 본다.
 */

export type OcrRow = {
  no: number;
  answer: number | null;
  /** 사진에 단원이 보였을 때만. 번호에 맞지 않는 단원(공통 문항에 미적분 단원)은 버린다. */
  unit_code: string | null;
};

export type OcrResult =
  | {
      ok: true;
      rows: OcrRow[];
      note: string;
      /** 정답을 못 읽은 번호. 화면이 이 번호들을 따로 짚어 준다. */
      unread: number[];
      /** 같은 번호에 서로 다른 답이 온 번호. 어느 쪽도 믿지 않고 비웠다. */
      conflicts: number[];
    }
  | { ok: false; reason: string };

type Extracted = { no: number; answer: number | null; unit_code: string | null };

/**
 * 모델이 준 것을 거른다.
 *
 *   · 1–30 이 아닌 번호는 버린다.
 *   · 5지선다에 6, 단답형에 1000 처럼 그 번호에 올 수 없는 답은 비운다.
 *   · 같은 번호가 두 번 오면 — 답이 같으면 하나로, 다르면 **비운다**. 둘 중 하나를 고르면
 *     틀린 쪽을 고른 날 조용히 틀린 채점이 된다. 비워 두면 최소한 빈 칸이 보인다.
 */
export function normalizeExtracted(questions: Extracted[]): {
  rows: OcrRow[];
  unread: number[];
  conflicts: number[];
} {
  const byNo = new Map<number, OcrRow>();
  const conflicts = new Set<number>();

  for (const q of questions) {
    if (!isQuestionNo(q.no)) continue;
    const answer = isValidAnswer(q.no, q.answer) ? q.answer : null;
    const unit_code = unitFits(q.no, q.unit_code) ? q.unit_code : null;

    const seen = byNo.get(q.no);
    if (!seen) {
      byNo.set(q.no, { no: q.no, answer, unit_code });
      continue;
    }
    if (seen.answer !== null && answer !== null && seen.answer !== answer) conflicts.add(q.no);
    seen.answer = conflicts.has(q.no) ? null : (seen.answer ?? answer);
    seen.unit_code = seen.unit_code ?? unit_code;
  }

  const rows = [...byNo.values()].sort((a, b) => a.no - b.no);
  const unread = PAPER.map((p) => p.no).filter((no) => (byNo.get(no)?.answer ?? null) === null);
  return { rows, unread, conflicts: [...conflicts].sort((a, b) => a - b) };
}

/* ─────────────────────────────────────────────── 학생 시험지에서 읽은 답 */

/**
 * 사진에서 읽은 학생 답 한 문항. 합친 뒤에는 1–30 번에 한 줄씩 있다.
 *
 * answer 가 null 이면 빈칸이거나 못 읽은 것이고, 둘은 sure 로 가른다 — 빈칸이 확실하면
 * sure 다. 채점에는 sure 인 줄만 들어간다 (0016 apply_photo_read_locked).
 */
export type ReadAnswer = {
  no: number;
  answer: number | null;
  sure: boolean;
  /** 확인할 문항에 붙는 짧은 이유 */
  note: string | null;
};

/** 모델 요청 한 번의 결과. 사진을 몇 장씩 나눠 보내서 여러 개가 온다. */
export type ReadBatch = {
  /** 이 요청에 보낸 첫 사진의 순번(0부터) */
  offset: number;
  /** 이 요청에 보낸 사진 수 */
  count: number;
  answers: { no: number; answer: number | null; sure: boolean; note: string | null }[];
  /** 모델이 매긴 사진 번호(이 요청 안에서 1부터) */
  unreadable_photos: number[];
};

export const READ_NOTES = {
  missing: '사진에서 이 문항을 찾지 못했어요',
  invalid: (value: number) => `이 문항에 올 수 없는 답(${value})으로 읽혔어요`,
  conflict: (a: number, b: number) => `사진마다 다르게 읽혔어요 (${a} · ${b})`,
  mixed: (value: number) => `다른 사진에서는 ${value} 로 읽혔어요`,
};

const NOTE_MAX = 80;

function cleanNote(note: string | null | undefined): string | null {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return Array.from(text).length > NOTE_MAX ? `${Array.from(text).slice(0, NOTE_MAX - 1).join('')}…` : text;
}

type Merging = ReadAnswer & {
  /** 사진끼리 답이 엇갈렸다. 뒤에 무엇이 와도 풀리지 않는다. */
  conflict?: true;
  /** 그 번호에 올 수 없는 답으로 읽힌 적이 있다 (그 값) */
  odd?: number;
};

/**
 * 같은 문항이 여러 사진에서 읽혔을 때 하나로 합친다. 읽힌 순서와 상관없이 같은 답이 나온다.
 *
 *   · 답이 둘 다 있고 다르면 **비우고 잠근다**. 한쪽을 고르면 틀린 쪽을 고른 날 조용히
 *     틀린 채점이 된다.
 *   · 올 수 없는 답으로 읽힌 적이 있으면 확실하지 않다 — 다른 사진의 답이 있어도 확인한다.
 *   · 같은 답이면 한쪽이라도 확실할 때 확실하다.
 *   · 답과 빈칸이 만나면 답을 쓴다 — 문제지는 비워 두고 답안지에만 표시하는 학생이 많다.
 *   · 확실한 빈칸과 못 읽은 것이 만나면 못 읽은 쪽이다 — 흐린 사진에 답이 있었을 수 있다.
 */
function combine(a: Merging, b: Merging): Merging {
  if (a.conflict) return a;
  const no = a.no;

  if (a.answer !== null && b.answer !== null && a.answer !== b.answer) {
    return { no, answer: null, sure: false, note: READ_NOTES.conflict(a.answer, b.answer), conflict: true };
  }

  const answer = a.answer ?? b.answer;
  const odd = a.odd ?? b.odd;
  if (odd !== undefined) {
    return { no, answer, sure: false, note: answer !== null ? READ_NOTES.mixed(odd) : READ_NOTES.invalid(odd), odd };
  }

  if (a.answer !== null && b.answer !== null) {
    const sure = a.sure || b.sure;
    return { no, answer, sure, note: sure ? null : (a.note ?? b.note) };
  }
  if (a.answer !== null) return a;
  if (b.answer !== null) return b;

  if (a.sure && b.sure) return a;
  return a.sure ? b : a;
}

/**
 * 요청 여러 번의 결과를 1–30 번 한 벌로 합친다. 모델이 준 것은 여기서 다시 거른다 —
 * 구조화 출력이 보장하는 것은 키와 자료형까지다.
 *
 *   · 1–30 이 아닌 번호는 버린다.
 *   · 그 번호에 올 수 없는 답(5지선다에 7)은 못 읽은 것으로 두고, 다른 사진의 답과 만나면
 *     그 답도 확실하지 않은 것으로 내린다.
 *   · 어느 사진에서도 안 보인 번호는 '찾지 못함' 으로 채운다.
 *   · 못 읽은 사진 번호는 요청 안의 번호(1부터)를 전체 순번(0부터)으로 바꾼다.
 */
export function mergeStudentReads(batches: ReadBatch[]): { answers: ReadAnswer[]; unreadable: number[] } {
  const byNo = new Map<number, Merging>();
  const unreadable = new Set<number>();

  for (const batch of batches) {
    for (const raw of batch.answers) {
      if (!isQuestionNo(raw.no)) continue;
      const entry: Merging =
        raw.answer === null || isValidAnswer(raw.no, raw.answer)
          ? { no: raw.no, answer: raw.answer, sure: raw.sure === true, note: cleanNote(raw.note) }
          : { no: raw.no, answer: null, sure: false, note: READ_NOTES.invalid(raw.answer), odd: raw.answer };
      const seen = byNo.get(raw.no);
      byNo.set(raw.no, seen ? combine(seen, entry) : entry);
    }
    for (const k of batch.unreadable_photos) {
      if (Number.isInteger(k) && k >= 1 && k <= batch.count) unreadable.add(batch.offset + k - 1);
    }
  }

  const answers = PAPER.map((p): ReadAnswer => {
    const found = byNo.get(p.no);
    if (!found) return { no: p.no, answer: null, sure: false, note: READ_NOTES.missing };
    // 확실한 줄에는 이유가 필요 없다. 화면이 확인할 문항에만 이유를 붙인다.
    return { no: found.no, answer: found.answer, sure: found.sure, note: found.sure ? null : found.note };
  });

  return { answers, unreadable: [...unreadable].sort((a, b) => a - b) };
}

/** 읽은 결과를 한눈에. 튜터 화면과 반 화면이 같이 쓴다. */
export function readSummary(answers: ReadAnswer[]): {
  /** 확실히 읽힌 문항 수 (빈칸 포함) */
  sure: number;
  /** 사람이 확인해야 하는 번호 */
  check: number[];
  /** 확실한 빈칸 — 틀린 것으로 매겨진다 */
  blanks: number[];
} {
  return {
    sure: answers.filter((a) => a.sure).length,
    check: answers.filter((a) => !a.sure).map((a) => a.no),
    blanks: answers.filter((a) => a.sure && a.answer === null).map((a) => a.no),
  };
}
