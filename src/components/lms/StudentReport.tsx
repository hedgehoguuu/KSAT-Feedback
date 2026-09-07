import Link from 'next/link';
import { AREA_GROUPS, areaLabel, fmtRate, fmtScore } from '@/config/lms';
import type { studentHistory } from '@/lib/lms/exams';
import { AreaBars, markWeak } from './AreaBars';
import { Card, Empty, Stat } from './Shell';
import { TrendChart, type TrendPointView } from './TrendChart';

type History = Awaited<ReturnType<typeof studentHistory>>;

/**
 * 한 학생의 누적. 튜터가 보는 화면과 학생 본인이 보는 화면이 같은 부품을 쓴다 —
 * 학생이 보는 숫자와 튜터가 보는 숫자가 다르면 대화가 성립하지 않는다.
 * 다른 것은 무엇이 보이느냐뿐이다(학생에게는 공개한 회차만 넘어온다).
 */
export function StudentReport({
  history,
  hrefFor,
  classAverages,
}: {
  history: History;
  /** 회차를 눌렀을 때 갈 곳. 튜터는 채점 화면으로, 학생은 피드백 화면으로 간다. */
  hrefFor: (attemptId: string) => string;
  classAverages?: Map<string, number>;
}) {
  const scored = history.points.filter((p) => p.score.complete && p.score.total > 0);

  const trend: TrendPointView[] = scored.map((p) => ({
    label: p.exam.title,
    sub: p.exam.exam_date ? p.exam.exam_date.slice(5).replace('-', '/') : null,
    value: (p.score.earned / p.score.total) * 100,
    raw: `${fmtScore(p.score.earned)} / ${fmtScore(p.score.total)}점`,
  }));

  const average = trend.length ? trend.reduce((sum, p) => sum + p.value, 0) / trend.length : 0;
  const latest = trend.length ? trend[trend.length - 1].value : null;
  const previous = trend.length > 1 ? trend[trend.length - 2].value : null;

  const bars = markWeak(
    history.trends.map((a) => ({
      code: a.code,
      label: a.label,
      rate: a.rate,
      correct: a.correct,
      graded: a.graded,
      count: a.count,
      reference: classAverages?.get(a.code) ?? null,
    })),
  );

  if (history.points.length === 0) {
    return (
      <Card>
        <Empty>아직 쌓인 회차가 없어요. 시험을 보고 채점이 끝나면 여기에 나와요.</Empty>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="본 회차" value={String(history.points.length)} unit="개" />
        <Stat
          label="평균"
          value={trend.length ? fmtScore(average) : '—'}
          unit={trend.length ? '점' : undefined}
          note="100점 환산"
        />
        <Stat
          label="최근"
          value={latest !== null ? fmtScore(latest) : '—'}
          unit={latest !== null ? '점' : undefined}
          note={
            latest !== null && previous !== null
              ? `지난 회차보다 ${latest - previous >= 0 ? '+' : ''}${fmtScore(latest - previous)}`
              : undefined
          }
        />
        <Stat
          label="가장 약한 영역"
          value={bars[0] ? bars[0].label : '—'}
          note={bars[0] ? `정답률 ${fmtRate(bars[0].rate)}` : undefined}
        />
      </div>

      {trend.length > 0 ? (
        <Card title="회차별 점수">
          <p className="mb-3 text-[13px] text-muted">
            회차마다 만점이 달라서 100점으로 환산한 값이에요.
          </p>
          <TrendChart points={trend} />

          {/* 그래프가 안 보이거나 정확한 값이 필요할 때를 위해 같은 값을 표로도 둔다. */}
          <div className="lms-scroll mt-4">
            <table className="lms-table">
              <thead>
                <tr>
                  <th>회차</th>
                  <th>날짜</th>
                  <th className="num">원점수</th>
                  <th className="num">100점 환산</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((p, i) => (
                  <tr key={p.attempt.id}>
                    <td className="font-bold">{p.exam.title}</td>
                    <td className="text-muted">{p.exam.exam_date ?? '—'}</td>
                    <td className="num">
                      {fmtScore(p.score.earned)} / {fmtScore(p.score.total)}
                    </td>
                    <td className="num font-bold">{fmtScore(trend[i].value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {bars.length > 0 ? (
        <Card title="영역별 정답률 (누적)">
          <AreaBars rows={bars} />
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            문항이 적은 영역은 한 문항만 틀려도 정답률이 크게 떨어져요. 옆의 맞은 개수를 함께 봐주세요.
          </p>
        </Card>
      ) : null}

      <Card title="회차별 피드백">
        <ul className="glass-divide flex flex-col">
          {[...history.points].reverse().map((p) => (
            <li key={p.attempt.id} className="py-4 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={hrefFor(p.attempt.id)} className="text-[15px] font-bold hover:underline">
                  {p.exam.title}
                </Link>
                <p className="text-[13px] text-muted">
                  {p.exam.exam_date ?? '날짜 미정'}
                  {p.score.graded > 0 ? (
                    <>
                      {' · '}
                      <span className="font-bold text-foreground">
                        {fmtScore(p.score.earned)} / {fmtScore(p.score.total)}점
                      </span>
                    </>
                  ) : null}
                </p>
              </div>

              {p.score.wrongNos.length > 0 ? (
                <p className="mt-1 text-[13px] text-muted">틀린 문항 {p.score.wrongNos.join(', ')}</p>
              ) : null}

              {p.attempt.overall_comment ? (
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.7]">
                  {p.attempt.overall_comment}
                </p>
              ) : null}

              {p.areaComments.size > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {[...p.areaComments.entries()].map(([code, comment]) => (
                    <li key={code} className="text-[13px] leading-[1.7]">
                      <span className="font-bold">{areaLabel(code)}</span>{' '}
                      <span className="text-muted">{comment}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {p.score.groups.length > 0 ? (
                <p className="mt-2 text-[12px] text-muted">
                  {p.score.groups
                    .map((g) => `${AREA_GROUPS[g.group]} ${g.correct}/${g.graded || g.count}`)
                    .join(' · ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
