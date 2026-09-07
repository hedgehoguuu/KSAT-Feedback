import { fmtRate } from '@/config/lms';

/**
 * 영역별 정답률 가로 막대. SVG 가 아니라 그냥 HTML 이다 —
 * 글자가 화면 폭에 따라 줄바꿈돼야 하는데 viewBox 안의 글자는 같이 찌그러진다.
 *
 * 색은 파랑 하나뿐이다. 영역마다 색을 달리하면 여덟 가지 색이 필요한데,
 * 여기서 색이 말해야 하는 건 '어느 영역인가'(그건 옆의 글자가 이미 말한다)가 아니라
 * '얼마나 맞았나'(그건 막대 길이가 말한다)라서 색을 더 쓸 이유가 없다.
 *
 * 딱 하나 예외가 약한 영역이다. 빨간펜 색을 쓰되 늘 '약함' 딱지를 함께 단다 —
 * 색만으로 말하면 색을 구별 못 하는 사람에게는 아무 말도 안 한 것이다.
 */

export type AreaBarRow = {
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

export function AreaBars({
  rows,
  referenceLabel = '반 평균',
}: {
  rows: AreaBarRow[];
  referenceLabel?: string;
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
            <span className="w-16 shrink-0 text-[13px] font-bold">{row.label}</span>

            <span className="relative h-4 flex-1 overflow-hidden rounded-[4px] chart-track">
              {/* 데이터 끝만 둥글다. 시작선(0)이 흐려지면 길이를 눈으로 못 잰다. */}
              <span
                className={`absolute inset-y-0 left-0 rounded-r-[4px] ${row.weak ? 'chart-bar-weak' : 'chart-bar'}`}
                style={{ width: `${Math.max(row.rate * 100, row.rate > 0 ? 2 : 0)}%` }}
              />
              {typeof row.reference === 'number' ? (
                <span
                  className="absolute inset-y-0 w-[2px] chart-ref"
                  style={{ left: `calc(${row.reference * 100}% - 1px)`, background: 'var(--muted)' }}
                  aria-hidden
                />
              ) : null}
            </span>

            <span className="w-11 shrink-0 text-right text-[13px] font-bold tabular-nums">
              {fmtRate(row.rate)}
            </span>
            <span className="w-16 shrink-0 text-right text-[12px] text-muted tabular-nums">
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
 * 정답률이 낮은 쪽 두 영역에 '약함' 표시를 단다.
 * 세 개 넘게 칠하면 다 빨개져서 어디를 먼저 볼지 알 수 없다.
 * 그리고 애초에 맞은 게 반이 넘으면 약하다고 하지 않는다.
 */
export function markWeak<T extends { rate: number; graded: number }>(rows: T[]): (T & { weak: boolean })[] {
  const ranked = [...rows].filter((r) => r.graded > 0).sort((a, b) => a.rate - b.rate);
  const weakSet = new Set(ranked.slice(0, 2).filter((r) => r.rate < 0.5));
  return rows.map((r) => ({ ...r, weak: weakSet.has(r) }));
}
