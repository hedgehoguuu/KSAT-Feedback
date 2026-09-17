import { fmtRate } from '@/config/lms';

/**
 * 정답률 가로 막대. 단원별 · 배점별 · 공통/미적분이 모두 이 부품을 쓴다.
 * SVG 가 아니라 그냥 HTML 이다 — 글자가 화면 폭에 따라 줄바꿈돼야 하는데
 * viewBox 안의 글자는 같이 찌그러진다.
 *
 * 색은 파랑 하나뿐이다. 여기서 색이 말해야 하는 건 '어느 칸인가'(그건 옆의 글자가 이미
 * 말한다)가 아니라 '얼마나 맞았나'(그건 막대 길이가 말한다)라서 색을 더 쓸 이유가 없다.
 *
 * 딱 하나 예외가 약한 칸이다. 빨간펜 색을 쓰되 늘 '약함' 딱지를 함께 단다 —
 * 색만으로 말하면 색을 구별 못 하는 사람에게는 아무 말도 안 한 것이다.
 */

export type RateBarRow = {
  code: string;
  label: string;
  /** 0~1 */
  rate: number;
  correct: number;
  graded: number;
  count: number;
  /** 반 평균 정답률 0~1. 있으면 눈금으로 그린다. */
  reference?: number | null;
  weak?: boolean;
};

export function RateBars({
  rows,
  referenceLabel = '반 평균',
  labelWidth = 'w-28',
}: {
  rows: RateBarRow[];
  referenceLabel?: string;
  /** 단원 이름은 길고 배점(2점)은 짧다. 칸 폭을 부르는 쪽이 정한다. */
  labelWidth?: string;
}) {
  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-[13px] text-muted">아직 채점된 문항이 없어요.</p>;
  }

  const hasReference = rows.some((r) => typeof r.reference === 'number');

  return (
    <div>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.code} className="flex items-center gap-3">
            <span className={`${labelWidth} shrink-0 text-[13px] font-bold leading-[1.3]`}>{row.label}</span>

            <span className="relative h-4 flex-1 overflow-hidden rounded-[4px] chart-track">
              {/* 데이터 끝만 둥글다. 시작선(0)이 흐려지면 길이를 눈으로 못 잰다. */}
              <span
                className={`absolute inset-y-0 left-0 rounded-r-[4px] ${row.weak ? 'chart-bar-weak' : 'chart-bar'}`}
                style={{ width: `${Math.max(row.rate * 100, row.rate > 0 ? 2 : 0)}%` }}
              />
              {typeof row.reference === 'number' ? (
                <span
                  className="absolute inset-y-0 w-[2px] chart-ref"
                  style={{ left: `calc(${row.reference * 100}% - 1px)` }}
                  aria-hidden
                />
              ) : null}
            </span>

            <span className="w-11 shrink-0 text-right text-[13px] font-bold tabular-nums">
              {fmtRate(row.rate)}
            </span>
            <span className="w-14 shrink-0 text-right text-[12px] text-muted tabular-nums">
              {row.correct}/{row.graded || row.count}
            </span>
            {row.weak ? (
              <span className="shrink-0 rounded-md bg-mark-soft px-1.5 py-0.5 text-[11px] font-bold text-mark">
                약함
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {hasReference ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <span className="inline-block h-3 w-[2px] bg-muted" aria-hidden />
          {referenceLabel}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 정답률이 낮은 쪽 두 칸에 '약함' 표시를 단다.
 * 세 개 넘게 칠하면 다 빨개져서 어디를 먼저 볼지 알 수 없다.
 * 그리고 애초에 맞은 게 반이 넘으면 약하다고 하지 않는다.
 */
export function markWeak<T extends { rate: number; graded: number }>(rows: T[]): (T & { weak: boolean })[] {
  const ranked = [...rows].filter((r) => r.graded > 0).sort((a, b) => a.rate - b.rate);
  const weakSet = new Set(ranked.slice(0, 2).filter((r) => r.rate < 0.5));
  return rows.map((r) => ({ ...r, weak: weakSet.has(r) }));
}

/** 점수 칸(Part · Trend)을 막대 줄로. 반 평균이 있으면 눈금으로 붙인다. */
export function barsOf(
  parts: { code: string; label: string; rate: number; correct: number; graded: number; count: number }[],
  references?: Map<string, number> | Record<string, number>,
): (RateBarRow & { weak: boolean })[] {
  const refOf = (code: string) =>
    references instanceof Map ? references.get(code) : references ? references[code] : undefined;
  return markWeak(
    parts.map((p) => ({
      code: p.code,
      label: p.label,
      rate: p.rate,
      correct: p.correct,
      graded: p.graded,
      count: p.count,
      reference: refOf(p.code) ?? null,
    })),
  );
}

type Countable = { code: string; label: string; correct: number; graded: number; count: number };

/**
 * 반 평균 막대. 길이는 학생마다의 정답률을 평균 낸 값이고(많이 매긴 학생이 평균을 끌고 가지 않게),
 * 옆의 개수는 학생들의 문항을 모두 더한 것이다. 학생 한 명의 칸 목록을 여럿 받는다.
 */
export function classBarsOf(lists: Countable[][], averages: Map<string, number>): (RateBarRow & { weak: boolean })[] {
  const acc = new Map<string, Countable>();
  for (const list of lists) {
    for (const part of list) {
      const cur = acc.get(part.code) ?? { code: part.code, label: part.label, correct: 0, graded: 0, count: 0 };
      cur.correct += part.correct;
      cur.graded += part.graded;
      cur.count += part.count;
      acc.set(part.code, cur);
    }
  }
  return barsOf(
    [...acc.values()]
      .filter((a) => averages.has(a.code))
      .map((a) => ({ ...a, rate: averages.get(a.code)! })),
  );
}
