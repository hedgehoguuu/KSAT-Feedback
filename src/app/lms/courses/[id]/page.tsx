import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { RateBars, classBarsOf } from '@/components/lms/RateBars';
import { Card, Empty, Shell, Stat, btn, btnGhost, input, label } from '@/components/lms/Shell';
import { EXAM_STATUS, LMS, fmtDay, fmtRate, fmtScore } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { courseSummary } from '@/lib/lms/exams';
import { listStudents } from '@/lib/lms/users';
import { createExam, enrollStudent, removeStudent, resetStudentPassword } from '../../course-actions';

export const dynamic = 'force-dynamic';

export default async function CoursePage({ params, searchParams }: PageProps<'/lms/courses/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { error, reset } = await searchParams;

  const course = await courseVisibleTo(id, me);
  if (!course) notFound();

  const [summary, allStudents] = await Promise.all([courseSummary(id), listStudents()]);
  const enrolledIds = new Set(summary.rows.map((r) => r.student.id));
  const candidates = allStudents.filter((s) => !enrolledIds.has(s.id) && s.status === 'active');

  // 반 누적 정답률. 어느 단원 · 어느 배점이 반 전체의 약점인지가 다음 수업의 재료다.
  const unitBars = classBarsOf(summary.rows.map((r) => r.trends.units), summary.partAverages).sort((a, b) => a.rate - b.rate);
  const pointBars = classBarsOf(summary.rows.map((r) => r.trends.byPoints), summary.partAverages);

  return (
    <Shell user={me}>
      <Link href="/lms/tutor" className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← 내 반
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-extrabold">{course.name}</h1>
        {/* 서버 함수는 파일을 못 내려보낸다. 라우트로 직접 간다. */}
        <a href={`/lms/courses/${course.id}/export`} className={btnGhost} download>
          성적 CSV 내려받기
        </a>
      </div>

      {reset ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          비밀번호를 새로 발급했어요. 학생에게 알려주세요 — 처음 들어올 때 본인이 다시 바꾸게 돼요.
        </p>
      ) : null}
      {error === 'weak' ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          비밀번호는 {LMS.minPasswordLength}자 이상이어야 해요.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat label="수강생" value={String(summary.rows.length)} unit="명" />
        <Stat label="시험 회차" value={String(summary.exams.length)} unit="개" />
        <Stat
          label="반 평균"
          value={summary.average ? fmtScore(summary.average) : '—'}
          unit={summary.average ? '점' : undefined}
          note="100점 환산 · 채점 끝난 회차만"
        />
        <Stat
          label="채점 끝난 학생"
          value={String(summary.rows.filter((r) => r.taken > 0).length)}
          unit="명"
        />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {/* ── 회차 */}
        <Card title={`시험 회차 ${summary.exams.length}개`}>
          <form action={createExam} className="mb-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="course_id" value={course.id} />
            <div className="min-w-52 flex-1">
              <label className={label} htmlFor="title">회차 이름</label>
              <input id="title" name="title" required placeholder="3주차 · 강대K 5회" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="exam_date">시험 날짜</label>
              <input id="exam_date" name="exam_date" type="date" className={input} />
            </div>
            <div>
              <label className={label} htmlFor="due_date">답 달 기한 (다음 수업)</label>
              <input id="due_date" name="due_date" type="date" className={input} />
            </div>
            <button type="submit" className={btn}>회차 만들기</button>
            {error === 'title' ? (
              <p className="text-[13px] text-danger" role="alert">회차 이름을 적어주세요</p>
            ) : null}
          </form>
          <p className="-mt-2 mb-4 text-[12px] text-muted">
            답 달 기한을 비우면 시험 날짜 + {LMS.replyDays}일로 잡아요. 학생 화면에 &lsquo;이 날 수업 전까지 답을 받아요&rsquo; 로 보여요.
          </p>

          {summary.exams.length === 0 ? (
            <Empty>아직 회차가 없어요. 위에서 하나 만들면 정답표부터 넣게 돼요.</Empty>
          ) : (
            <ul className="glass-divide flex flex-col">
              {summary.exams.map((exam) => (
                <li key={exam.id} className="py-3 first:pt-0">
                  <Link href={`/lms/exams/${exam.id}`} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-bold">
                        {exam.title}
                        {exam.status === 'draft' ? (
                          <span className="ml-2 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-bold text-muted">
                            {EXAM_STATUS.draft}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted">
                        {exam.exam_date ? `${fmtDay(exam.exam_date)} 시험` : '날짜 미정'}
                        {exam.due_date ? ` · 답 달 기한 ${fmtDay(exam.due_date)}` : ''}
                      </p>
                    </div>
                    <span className="text-[13px] font-bold text-brand">열기 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── 학생 비교 */}
        <Card title="학생 누적">
          {summary.rows.length === 0 ? (
            <Empty>아직 수강생이 없어요. 아래에서 넣어주세요.</Empty>
          ) : (
            <div className="lms-scroll">
              <table className="lms-table">
                <thead>
                  <tr>
                    <th className="w-12">석차</th>
                    <th>이름</th>
                    <th className="num">평균</th>
                    <th className="num">최근</th>
                    <th className="num">반 평균 대비</th>
                    <th className="num">회차</th>
                    <th className="num">4점 정답률</th>
                    <th>약한 단원</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row) => {
                    const weakest = row.trends.units.slice(0, 2);
                    const four = row.trends.byPoints.find((t) => t.code === 'p4');
                    const diff = row.taken > 0 ? row.average - summary.average : null;
                    return (
                      <tr key={row.student.id}>
                        <td className="font-bold">{row.rank || '—'}</td>
                        <td className="font-bold">{row.student.name}</td>
                        <td className="num font-bold">{row.taken ? fmtScore(row.average) : '—'}</td>
                        <td className="num">{row.latest !== null ? fmtScore(row.latest) : '—'}</td>
                        <td className={`num ${diff !== null && diff < 0 ? 'text-mark' : 'text-muted'}`}>
                          {diff === null ? '—' : `${diff >= 0 ? '+' : ''}${fmtScore(diff)}`}
                        </td>
                        <td className="num text-muted">{row.taken}</td>
                        <td className="num text-muted">{four ? fmtRate(four.rate) : '—'}</td>
                        <td className="text-muted">
                          {weakest.length
                            ? weakest.map((a) => `${a.label} ${fmtRate(a.rate)}`).join(' · ')
                            : '—'}
                        </td>
                        <td>
                          <Link
                            // 어느 반에서 왔는지 알려 준다 — 학생이 두 반에 있으면
                            // 그 화면의 '반 평균' 이 엉뚱한 반 것이 될 수 있다.
                            href={`/lms/students/${row.student.id}?course=${course.id}`}
                            className="text-[13px] font-bold text-brand underline underline-offset-2"
                          >
                            보기
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            채점이 끝난 회차만 평균에 들어가요. 약한 단원은 정답표에 단원을 붙인 문항으로만 세요.
          </p>
        </Card>

        {/* ── 반의 약점 */}
        {pointBars.length > 0 ? (
          <Card title="반 전체 누적 정답률">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">배점별</p>
                <RateBars rows={pointBars} labelWidth="w-10" referenceLabel="" />
              </div>
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">단원별 · 약한 순</p>
                {unitBars.length > 0 ? (
                  <RateBars rows={unitBars} referenceLabel="" />
                ) : (
                  <p className="text-[13px] leading-[1.6] text-muted">정답표에 단원을 붙인 회차가 쌓이면 여기에 나와요.</p>
                )}
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-[1.6] text-muted">
              누적된 모든 회차를 합쳐서 봐요. 여기서 낮은 칸이 다음 수업에서 다룰 것이에요.
            </p>
          </Card>
        ) : null}

        {/* ── 수강생 관리 */}
        <Card title={`수강생 ${summary.rows.length}명`}>
          <form action={enrollStudent} className="mb-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="course_id" value={course.id} />
            <div className="min-w-52 flex-1">
              <label className={label} htmlFor="student_id">학생 넣기</label>
              <select id="student_id" name="student_id" required className={input} defaultValue="">
                <option value="" disabled>고르기</option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.profile?.grade ? ` · 고${s.profile.grade}` : ''}
                    {s.profile?.school ? ` · ${s.profile.school}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={btn} disabled={candidates.length === 0}>
              넣기
            </button>
          </form>

          {candidates.length === 0 && summary.rows.length === 0 ? (
            <p className="mb-3 text-[13px] text-muted">
              넣을 학생 계정이 없어요.{' '}
              {me.role === 'admin' ? (
                <Link href="/lms/admin" className="font-bold text-brand underline underline-offset-2">
                  계정 만들기
                </Link>
              ) : (
                '관리자에게 학생 계정 발급을 부탁해주세요.'
              )}
            </p>
          ) : null}

          {summary.rows.length > 0 ? (
            <ul className="glass-divide flex flex-col">
              {summary.rows.map((row) => (
                <li key={row.student.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <div>
                    <p className="text-[14px] font-bold">{row.student.name}</p>
                    <p className="text-[12px] text-muted">
                      {row.student.login_id}
                      {row.student.profile?.grade ? ` · 고${row.student.profile.grade}` : ''}
                      {row.student.profile?.parent_phone ? ` · 학부모 ${row.student.profile.parent_phone}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 학생이 비번을 잊은 날 관리자를 기다리면 그 수업이 멈춘다. */}
                    <form action={resetStudentPassword} className="flex items-center gap-2">
                      <input type="hidden" name="course_id" value={course.id} />
                      <input type="hidden" name="student_id" value={row.student.id} />
                      <input
                        name="password"
                        required
                        minLength={LMS.minPasswordLength}
                        placeholder="새 비밀번호"
                        className={`${input} w-36`}
                        aria-label={`${row.student.name} 새 비밀번호`}
                      />
                      <button type="submit" className={btnGhost}>발급</button>
                    </form>
                    <form action={removeStudent}>
                      <input type="hidden" name="course_id" value={course.id} />
                      <input type="hidden" name="student_id" value={row.student.id} />
                      <ConfirmSubmit
                        className={btnGhost}
                        message={`${row.student.name} 학생을 이 반에서 뺍니다.\n\n계정과 지난 성적은 그대로 남아요.`}
                      >
                        빼기
                      </ConfirmSubmit>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            반에서 빼도 계정과 지난 성적은 그대로 남아요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
