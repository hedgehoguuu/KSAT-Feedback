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
