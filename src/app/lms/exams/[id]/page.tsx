import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AreaBars, markWeak } from '@/components/lms/AreaBars';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { Card, Empty, Shell, Stat, btn, btnDanger, btnGhost, input, label } from '@/components/lms/Shell';
import { ELECTIVES, PUBLISH_STATUS, fmtScore } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, getExam, listQuestions } from '@/lib/lms/exams';
import { publishExamGrades, removeExam, startGrading, updateExam } from '../../course-actions';

export const dynamic = 'force-dynamic';

export default async function ExamPage({ params, searchParams }: PageProps<'/lms/exams/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { saved, published, skipped } = await searchParams;

  const exam = await getExam(id);
  if (!exam) notFound();
  const course = await courseVisibleTo(exam.course_id, me);
  if (!course) notFound();

  const [board, questions] = await Promise.all([examBoard(exam), listQuestions(exam.id)]);
  const fullScore = questions.reduce((sum, q) => sum + q.points, 0);

  const classBars = markWeak(
    [...board.stats.areaAverages.entries()].map(([code, rate]) => {
      const sample = board.rows.flatMap((r) => r.score.areas).filter((a) => a.code === code);
      return {
        code,
        label: sample[0]?.label ?? code,
        rate,
        correct: sample.reduce((s, a) => s + a.correct, 0),
        graded: sample.reduce((s, a) => s + a.graded, 0),
        count: sample[0]?.count ?? 0,
      };
    }),
  );

  const gradedCount = board.rows.filter((r) => r.score.complete).length;

  return (
    <Shell user={me}>
      <Link
        href={`/lms/courses/${course.id}`}
        className="text-[13px] font-semibold text-muted underline underline-offset-2"
      >
        ← {course.name}
      </Link>
      <h1 className="mt-3 text-[20px] font-extrabold">
        {exam.title}
        {exam.status === 'draft' ? (
          <span className="ml-2 rounded-md bg-surface px-2 py-1 text-[12px] font-bold text-muted align-middle">
            {PUBLISH_STATUS.draft}
          </span>
        ) : null}
      </h1>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">저장했어요.</p>
      ) : null}
      {published !== undefined ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          {Number(published) > 0 ? `${published}명을 학생에게 공개했어요.` : '새로 공개할 학생이 없었어요.'}
          {Number(skipped) > 0 ? (
            <span className="text-muted">
              {' '}채점이 아직 안 끝난 {skipped}명은 그대로 뒀어요 — 반쪽짜리 점수는 공개하지 않아요.
            </span>
          ) : null}
          {exam.status === 'draft' && Number(published) > 0 ? (
            <span className="mt-1 block font-bold text-danger">
              회차가 아직 비공개라 학생에게는 안 보여요. 아래 &lsquo;회차 공개&rsquo;를 공개로 바꿔주세요.
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="문항" value={String(questions.length)} unit="개" note={`배점 합 ${fmtScore(fullScore)}점`} />
        <Stat label="채점 끝" value={`${gradedCount}`} unit={`/ ${board.rows.length}명`} />
        <Stat
          label="반 평균"
          value={board.stats.counted ? fmtScore(board.stats.average) : '—'}
          unit={board.stats.counted ? '점' : undefined}
          note="채점 끝난 학생만"
        />
        <Stat
          label="최고 · 최저"
          value={board.stats.counted ? `${fmtScore(board.stats.highest)} · ${fmtScore(board.stats.lowest)}` : '—'}
        />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        <Card
          title="문항표"
          action={
            <Link href={`/lms/exams/${exam.id}/questions`} className={btnGhost}>
              문항표 고치기
            </Link>
          }
        >
          {questions.length === 0 ? (
            <Empty>문항표가 아직 없어요. 문항표를 먼저 만들어야 채점할 수 있어요.</Empty>
          ) : (
            <p className="text-[14px] leading-[1.7]">
              {questions.length}문항 · 배점 합 {fmtScore(fullScore)}점 ·{' '}
              <span className="text-muted">
                {[...new Set(questions.map((q) => q.area_code))].length}개 영역
              </span>
            </p>
          )}
        </Card>

        <Card
          title={`학생 ${board.rows.length}명`}
          action={
            <form action={publishExamGrades}>
              <input type="hidden" name="exam_id" value={exam.id} />
              <button type="submit" className={btnGhost} disabled={gradedCount === 0}>
                채점 끝난 {gradedCount}명 한 번에 공개
              </button>
            </form>
          }
        >
          {board.rows.length === 0 ? (
            <Empty>
              이 반에 수강생이 없어요.{' '}
              <Link href={`/lms/courses/${course.id}`} className="font-bold text-brand underline underline-offset-2">
                학생 넣기
              </Link>
            </Empty>
          ) : (
            <div className="lms-scroll">
              <table className="lms-table">
                <thead>
                  <tr>
                    <th className="w-12">석차</th>
                    <th>이름</th>
                    <th>선택</th>
                    <th className="num">점수</th>
                    <th className="num">평균 대비</th>
                    <th className="num">틀린 문항</th>
                    <th>상태</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => {
                    const standing = board.stats.standings.find((s) => s.studentId === row.student.id);
                    const elective = row.attempt?.elective ?? row.student.profile?.elective ?? null;
                    return (
                      <tr key={row.student.id}>
                        <td className="font-bold">{standing?.rank || '—'}</td>
                        <td className="font-bold">{row.student.name}</td>
                        <td className="text-muted">{elective ? ELECTIVES[elective] : '—'}</td>
                        <td className="num font-bold">
                          {row.score.graded > 0 ? (
                            <>
                              {fmtScore(row.score.earned)}
                              <span className="text-[12px] font-normal text-muted">
                                {' '}/ {fmtScore(row.score.total)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td
                          className={`num ${
                            standing && row.score.complete && standing.vsAverage < 0 ? 'text-mark' : 'text-muted'
                          }`}
                        >
                          {standing && row.score.complete
                            ? `${standing.vsAverage >= 0 ? '+' : ''}${fmtScore(standing.vsAverage)}`
                            : '—'}
                        </td>
                        <td className="num text-muted">
                          {row.score.graded > 0 ? row.score.graded - row.score.correct : '—'}
                        </td>
                        <td className="text-muted">
                          {!row.attempt
                            ? '시작 전'
                            : !row.score.complete
                              ? `매기는 중 ${row.score.graded}/${row.score.count}`
                              : row.attempt.status === 'published'
                                ? '공개함'
                                : '채점 끝 · 비공개'}
                        </td>
                        <td>
                          <form action={startGrading}>
                            <input type="hidden" name="exam_id" value={exam.id} />
                            <input type="hidden" name="student_id" value={row.student.id} />
                            <button
                              type="submit"
                              className="text-[13px] font-bold text-brand underline underline-offset-2"
                              disabled={questions.length === 0}
                            >
                              {row.attempt ? '이어서 채점' : '채점하기'}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {classBars.length > 0 ? (
          <Card title="이 회차 영역별 반 평균">
            <AreaBars rows={classBars} referenceLabel="" />
          </Card>
        ) : null}

        <Card title="회차 정보">
          <form action={updateExam} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="exam_id" value={exam.id} />
            <div className="min-w-52 flex-1">
              <label className={label} htmlFor="title">회차 이름</label>
              <input id="title" name="title" defaultValue={exam.title} required className={input} />
            </div>
            <div>
              <label className={label} htmlFor="exam_date">시험 날짜</label>
              <input id="exam_date" name="exam_date" type="date" defaultValue={exam.exam_date ?? ''} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="status">회차 공개</label>
              <select id="status" name="status" defaultValue={exam.status} className={`${input} w-32`}>
                <option value="draft">작성 중</option>
                <option value="published">공개</option>
              </select>
            </div>
            <button type="submit" className={btn}>저장</button>
          </form>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            회차를 공개해도 학생에게는 <span className="font-bold">각자의 채점을 공개한 것만</span> 보여요.
            채점 화면에서 &lsquo;저장하고 학생에게 공개&rsquo;를 눌러야 그 학생이 볼 수 있어요.
          </p>

          <form action={removeExam} className="mt-4">
            <input type="hidden" name="exam_id" value={exam.id} />
            <ConfirmSubmit
              className={btnDanger}
              message={`'${exam.title}' 회차를 지웁니다.\n\n문항표 ${questions.length}문항과 학생 ${gradedCount}명의 채점 결과가 함께 사라지고 되돌릴 수 없어요.`}
            >
              회차 지우기
            </ConfirmSubmit>
          </form>
          <p className="mt-2 text-[13px] text-muted">
            문항표와 이 회차의 모든 채점 결과가 함께 사라져요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
