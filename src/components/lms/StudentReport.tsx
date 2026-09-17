import Link from 'next/link';
import { fmtDay, fmtRate, fmtScore } from '@/config/lms';
import type { HistoryPoint, studentHistory } from '@/lib/lms/exams';
import { RateBars, barsOf } from './RateBars';
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
  referenceLabel = '반 평균',
}: {
  history: History;
  /** 회차를 눌렀을 때 갈 곳. 튜터는 채점 화면으로, 학생은 그 시험 화면으로 간다. */
  hrefFor: (point: HistoryPoint) => string;
  classAverages?: Map<string, number>;
  /** 기준선이 어느 반 것인지. 학생이 두 반에 있으면 이름을 밝혀야 오해가 없다. */
  referenceLabel?: string;
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

  const unitBars = barsOf(history.trends.units, classAverages);
  const pointBars = barsOf(history.trends.byPoints, classAverages);
  const sectionBars = barsOf(history.trends.sections, classAverages);
  const weakest = unitBars.find((b) => b.weak) ?? null;
  const fourPoint = history.trends.byPoints.find((t) => t.code === 'p4');

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
        <Stat label="본 회차" value={String(scored.length)} unit="개" note="채점이 끝난 것" />
        <Stat
          label="평균"
          value={trend.length ? fmtScore(average) : '—'}
          unit={trend.length ? '점' : undefined}
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
        {weakest ? (
          <Stat label="가장 약한 단원" value={weakest.label} note={`정답률 ${fmtRate(weakest.rate)}`} />
        ) : (
          <Stat
            label="4점 문항 정답률"
            value={fourPoint ? fmtRate(fourPoint.rate) : '—'}
            note={fourPoint ? `${fourPoint.correct}/${fourPoint.graded}문항` : undefined}
          />
        )}
      </div>

      {trend.length > 0 ? (
        <Card title="회차별 점수">
          <TrendChart points={trend} />

          {/* 그래프가 안 보이거나 정확한 값이 필요할 때를 위해 같은 값을 표로도 둔다. */}
          <div className="lms-scroll mt-4">
            <table className="lms-table">
              <thead>
                <tr>
                  <th>회차</th>
                  <th>날짜</th>
                  <th className="num">점수</th>
                  {scored[0]?.score.sections.map((s) => (
                    <th key={s.code} className="num">{s.label}</th>
                  ))}
                  <th>틀린 문항</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((p) => (
                  <tr key={p.attempt.id}>
                    <td className="font-bold">{p.exam.title}</td>
                    <td className="text-muted">{p.exam.exam_date ?? '—'}</td>
                    <td className="num font-bold">
                      {fmtScore(p.score.earned)} / {fmtScore(p.score.total)}
                    </td>
                    {p.score.sections.map((s) => (
                      <td key={s.code} className="num">
                        {fmtScore(s.earned)} / {fmtScore(s.total)}
                      </td>
                    ))}
                    <td className="text-muted">{p.score.wrongNos.join(', ') || '없음'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {pointBars.length > 0 ? (
        <Card title="누적 정답률">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">공통 · 미적분</p>
                <RateBars rows={sectionBars} labelWidth="w-14" referenceLabel={referenceLabel} />
              </div>
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">배점별</p>
                <RateBars rows={pointBars} labelWidth="w-14" referenceLabel={referenceLabel} />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-extrabold text-muted">단원별 · 약한 순</p>
              {unitBars.length > 0 ? (
                <RateBars rows={unitBars} referenceLabel={referenceLabel} />
              ) : (
                <p className="text-[13px] leading-[1.6] text-muted">
                  정답표에 단원을 넣은 회차가 쌓이면 여기에 단원별 정답률이 나와요.
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            문항이 적은 칸은 한 문항만 틀려도 정답률이 크게 떨어져요. 옆의 맞은 개수를 함께 봐주세요.
          </p>
        </Card>
      ) : null}

      <Card title="회차별">
        <ul className="glass-divide flex flex-col">
          {[...history.points].reverse().map((p) => (
            <li key={p.attempt.id} className="py-4 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={hrefFor(p)} className="text-[15px] font-bold hover:underline">
                  {p.exam.title}
                </Link>
                <p className="text-[13px] text-muted">
                  {p.exam.exam_date ? fmtDay(p.exam.exam_date) : '날짜 미정'}
                  {p.score.graded > 0 ? (
                    <>
                      {' · '}
                      <span className="font-bold text-foreground">
                        {fmtScore(p.score.earned)} / {fmtScore(p.score.total)}점
                      </span>
                      {!p.score.complete ? ' (매기는 중)' : ''}
                    </>
                  ) : null}
                </p>
              </div>

              {p.score.wrongNos.length > 0 ? (
                <p className="mt-1 text-[13px] text-muted">틀린 문항 {p.score.wrongNos.join(', ')}</p>
              ) : null}

              {p.attempt.overall_comment ? (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[14px] leading-[1.7]">
                  {p.attempt.overall_comment}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
