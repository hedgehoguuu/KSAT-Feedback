import { fmtScore } from '@/config/lms';

/**
 * 회차별 점수 추이. 계열이 하나뿐이라 범례를 두지 않는다 — 제목이 이미 무엇인지 말한다.
 *
 * 세로축은 회차마다 다른 만점을 100점으로 환산한 값이다. 회차마다 문항 수와 배점 합이
 * 달라서 원점수를 그대로 이으면 시험이 쉬웠던 회차가 실력이 오른 것처럼 보인다.
 *
 * 값 딱지는 마지막 점 하나에만 붙인다. 모든 점에 숫자를 달면 아무도 안 읽는다 —
 * 나머지 값은 축과 바로 아래 표가 들고 있다.
 */

export type TrendPointView = {
  label: string;
  sub: string | null;
  /** 100점 환산 */
  value: number;
  raw: string;
};

const W = 640;
const H = 200;
const PAD = { top: 16, right: 52, bottom: 28, left: 32 };

export function TrendChart({ points }: { points: TrendPointView[] }) {
  if (points.length === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // 점이 하나뿐이면 나누기 0 이 된다. 그때는 가운데에 찍는다.
  const x = (i: number) =>
    points.length === 1 ? PAD.left + plotW / 2 : PAD.left + (plotW * i) / (points.length - 1);
  const y = (v: number) => PAD.top + plotH * (1 - Math.min(Math.max(v, 0), 100) / 100);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area =
    points.length > 1
      ? `${line} L${x(points.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${PAD.top + plotH} Z`
      : '';

  const last = points[points.length - 1];
  // 회차가 많아지면 가로축 글씨가 겹친다. 겹치기 전에 하나 걸러 하나만 적는다.
  const step = points.length > 8 ? Math.ceil(points.length / 8) : 1;

  return (
    <div className="lms-scroll">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`회차별 100점 환산 점수 추이. ${points.map((p) => `${p.label} ${fmtScore(p.value)}점`).join(', ')}`}
        style={{ width: '100%', minWidth: 520, height: 'auto' }}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-axis" x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        {area ? <path className="chart-area" d={area} /> : null}
        {points.length > 1 ? <path className="chart-line" d={line} /> : null}

        {points.map((p, i) => (
          <g key={p.label + i}>
            <circle className="chart-dot" cx={x(i)} cy={y(p.value)} r={4}>
              {/* 브라우저가 그려 주는 기본 말풍선. 자바스크립트 없이도 값이 나온다. */}
              <title>{`${p.label} · ${p.raw}`}</title>
            </circle>
            {i % step === 0 || i === points.length - 1 ? (
              <text className="chart-axis" x={x(i)} y={H - 8} textAnchor="middle">
                {p.sub ?? p.label}
              </text>
            ) : null}
          </g>
        ))}

        <text className="chart-label" x={x(points.length - 1) + 10} y={y(last.value) + 4}>
          {fmtScore(last.value)}
        </text>
      </svg>
    </div>
  );
}
