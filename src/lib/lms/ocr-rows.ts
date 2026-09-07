import { AREAS, LMS, layoutAreaFor } from '@/config/lms';

/**
 * 모델이 준 것을 우리 표 모양으로 다듬는 부분.
 *
 * 실제로 부르는 쪽(ocr.ts)과 떼어 뒀다. 거기는 API 키가 있어야 돌지만 여기는 순수 계산이라,
 * 키 없이도 그대로 불러 확인할 수 있다. 그리고 여기가 진짜 방어선이다 —
 * 구조화 출력이 보장하는 것은 키와 자료형까지고, 값이 목록 안에 있는지는 여기서 본다.
 */

export type OcrRow = {
  no: number;
  area_code: string;
  points: number;
  answer: number | null;
  passage: string | null;
  /** 영역을 사진에서 못 읽어 통상 배치로 채운 줄. 화면이 이걸 표시한다. */
  areaGuessed: boolean;
};

export type OcrResult =
  | { ok: true; rows: OcrRow[]; note: string; guessedCount: number }
  | { ok: false; reason: string };

/**
 * 모델이 준 것을 우리 표 모양으로 다듬는다.
 *
 * API 호출과 떼어 둔 이유: 여기가 실제로 틀릴 수 있는 곳이다. 범위 밖 번호, 못 읽은 영역,
 * 같은 문항이 두 번 온 경우 — 모델이 무엇을 주든 이 함수를 지나면 저장할 수 있는 모양이어야 한다.
 * 떼어 두면 키 없이도 확인할 수 있다.
 */
export function normalizeExtracted(
  questions: {
    no: number;
    area_code: string | null;
    points: number | null;
    answer: number | null;
    passage: string | null;
  }[],
): OcrRow[] {
  const rows: OcrRow[] = [];
  const seen = new Set<string>();

  for (const q of questions) {
    if (!Number.isInteger(q.no) || q.no < 1 || q.no > LMS.maxQuestionCount) continue;

    // 모델이 목록에 없는 코드를 지어낼 수도 있다. 그때도 못 읽은 것으로 친다.
    const known = q.area_code && AREAS.some((a) => a.code === q.area_code) ? q.area_code : null;
    // 못 읽은 영역은 통상 배치로 메운다. 메웠다는 사실을 줄마다 들고 간다.
    const areaGuessed = !known;
    const area_code = known ?? layoutAreaFor(q.no) ?? AREAS[0].code;

    // 같은 번호라도 영역이 다르면 다른 문항이다 (35번 화작 · 35번 언매).
    const key = `${q.no}|${area_code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      no: q.no,
      area_code,
      points: typeof q.points === 'number' && Number.isFinite(q.points) && q.points >= 0 ? q.points : 2,
      answer:
        typeof q.answer === 'number' && Number.isInteger(q.answer) && q.answer >= 1 && q.answer <= 5
          ? q.answer
          : null,
      passage: q.passage?.trim() || null,
      areaGuessed,
    });
  }

  return rows.sort((a, b) => a.no - b.no || a.area_code.localeCompare(b.area_code));
}

