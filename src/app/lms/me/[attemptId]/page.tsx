import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AreaBars, markWeak } from '@/components/lms/AreaBars';
import { Card, Shell, Stat } from '@/components/lms/Shell';
import { AREA_GROUPS, areaLabel, fmtRate, fmtScore } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { getExam, listAnswers, listAreaComments, listQuestions, getAttempt } from '@/lib/lms/exams';
import { scoreAttempt } from '@/lib/lms/score';

export const dynamic = 'force-dynamic';

/** 학생이 보는 회차 한 개. 자기 것만, 공개된 것만 열린다. */
export default async function MyAttemptPage({ params }: PageProps<'/lms/me/[attemptId]'>) {
  const me = await requireRole('student');
  const { attemptId } = await params;

  const attempt = await getAttempt(attemptId);
  // 남의 것이거나 아직 공개 전이면 없는 것과 같이 다룬다 — '있지만 못 본다' 도 정보다.
  if (!attempt || attempt.student_id !== me.id || attempt.status !== 'published') notFound();

  const [exam, questions, answers, areaComments] = await Promise.all([
    getExam(attempt.exam_id),
    listQuestions(attempt.exam_id),
    listAnswers(attemptId),
    listAreaComments(attemptId),
  ]);
  if (!exam) notFound();

  const score = scoreAttempt(questions, answers, attempt.elective);
  const bars = markWeak(
    score.areas.map((a) => ({
      code: a.code,
      label: a.label,
      rate: a.rate,
      correct: a.correct,
      graded: a.graded,
      count: a.count,
    })),
  );

  const wrongByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <Shell user={me}>
      <Link href="/lms/me" className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← 내 성적
      </Link>
      <h1 className="mt-3 text-[20px] font-extrabold">{exam.title}</h1>
      <p className="mt-1 text-[13px] text-muted">{exam.exam_date ?? '날짜 미정'}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="점수" value={fmtScore(score.earned)} unit={`/ ${fmtScore(score.total)}점`} />
        <Stat label="맞은 문항" value={`${score.correct}`} unit={`/ ${score.graded}개`} note={fmtRate(score.rate)} />
        <Stat
          label="가장 약한 영역"
          value={bars.filter((b) => b.weak)[0]?.label ?? bars[0]?.label ?? '—'}
          note={bars[0] ? `정답률 ${fmtRate(bars[0].rate)}` : undefined}
        />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {attempt.overall_comment ? (
          <Card title="총평">
            <p className="whitespace-pre-wrap text-[15px] leading-[1.8]">{attempt.overall_comment}</p>
          </Card>
        ) : null}

        <Card title="영역별">
          <AreaBars rows={bars} />

          <div className="mt-5 flex flex-col gap-4">
            {score.groups.map((group) => (
              <div key={group.group}>
                <p className="mb-2 text-[12px] font-extrabold text-muted">
                  {AREA_GROUPS[group.group]} · {group.correct}/{group.graded || group.count}
                </p>
                <ul className="flex flex-col gap-2">
                  {group.areas.map((area) =>
                    areaComments.get(area.code) ? (
                      <li key={area.code} className="glass-inset rounded-xl p-3">
                        <p className="text-[13px] font-extrabold">
                          {area.label}
                          <span className="ml-1.5 font-bold text-muted">
                            {area.correct}/{area.graded || area.count}
                          </span>
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.7]">
                          {areaComments.get(area.code)}
                        </p>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card title="문항별">
          <div className="lms-scroll">
            <table className="lms-table">
              <thead>
                <tr>
                  <th className="w-14">번호</th>
                  <th>영역</th>
                  <th className="num">배점</th>
                  <th>정오</th>
                  <th>정답</th>
                  <th>내가 고른 답</th>
                </tr>
              </thead>
              <tbody>
                {questions
                  .filter((q) => score.areas.some((a) => a.code === q.area_code))
                  .map((q) => {
                    const marked = wrongByQuestion.get(q.id);
                    return (
                      <tr key={q.id}>
                        <td className="font-bold">{q.no}</td>
                        <td className="text-muted">{areaLabel(q.area_code)}</td>
                        <td className="num text-muted">{fmtScore(q.points)}</td>
                        <td className={marked && !marked.correct ? 'font-extrabold text-mark' : 'text-muted'}>
                          {!marked ? '—' : marked.correct ? 'O' : 'X'}
                        </td>
                        <td className="text-muted">{q.answer ?? '—'}</td>
                        <td className="text-muted">{marked?.chosen ?? '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
