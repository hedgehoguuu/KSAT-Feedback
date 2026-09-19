import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { RateBars, classBarsOf } from '@/components/lms/RateBars';
import { Card, Empty, Shell, Stat, btn, btnDanger, btnGhost, input, label } from '@/components/lms/Shell';
import { EXAM_STATUS, QUESTION_COUNT } from '@/config/lms';
import { fmtDay, fmtScore } from '@/lib/format';
import { seoulDate, seoulStamp } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, getExam, type BoardRow } from '@/lib/lms/exams';
import { scoreShown } from '@/lib/lms/score';
import { removeExam, startGrading, updateExam } from '../../course-actions';

export const dynamic = 'force-dynamic';

export default async function ExamPage({ params, searchParams }: PageProps<'/lms/exams/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { saved } = await searchParams;

  const exam = await getExam(id);
  if (!exam) notFound();
  const course = await courseVisibleTo(exam.course_id, me);
  if (!course) notFound();

  const board = await examBoard(exam);
  const { questions } = board;
  const keyed = questions.filter((q) => q.answer !== null).length;
  const tagged = questions.filter((q) => q.unit_code).length;
  // 채점 끝 = 선생님이 다 매겨 저장한 것. 학생에게 보이는 것과 같은 기준이다 (scoreShown).
  const done = board.rows.filter((r) => r.attempt && scoreShown(r.attempt, r.score));
  const gradedCount = done.length;
  const submittedCount = board.rows.filter((r) => r.attempt?.submitted_at).length;
  const sentCount = board.rows.filter((r) => r.attempt?.feedback_ready_at).length;
  const today = seoulDate();
  const overdue = Boolean(exam.due_date && exam.due_date < today);

  const pointBars = classBarsOf(done.map((r) => r.score.byPoints), board.stats.partAverages);
  const unitBars = classBarsOf(done.map((r) => r.score.units), board.stats.partAverages);

  return (
    <Shell user={me}>
      <Link href={`/lms/courses/${course.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {course.name}
      </Link>
      <h1 className="mt-3 flex flex-wrap items-center gap-2 text-[20px] font-extrabold">
        {exam.title}
        <span
          className={`rounded-md px-2 py-1 text-[12px] font-bold ${
            exam.status === 'published' ? 'bg-brand/10 text-brand' : 'bg-surface text-muted'
          }`}
        >
          {EXAM_STATUS[exam.status]}
        </span>
      </h1>
      <p className="mt-1 text-[13px] text-muted">
        {exam.exam_date ? `시험 ${fmtDay(exam.exam_date)}` : '시험 날짜 미정'}
        {exam.due_date ? (
          <span className={overdue && sentCount < submittedCount ? 'font-bold text-mark' : ''}>
            {' · '}답 달 기한 {fmtDay(exam.due_date)}
            {overdue && sentCount < submittedCount ? ' (지났어요)' : ''}
          </span>
        ) : null}
      </p>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">저장했어요.</p>
      ) : null}
      {exam.status === 'draft' ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[13px] font-bold leading-[1.6] text-mark">
          아직 학생에게 안 보이는 회차예요. 시험을 본 뒤 아래 &lsquo;회차 정보&rsquo; 에서 &lsquo;학생에게 열림&rsquo; 으로
          바꾸면 학생들이 점수를 보고 시험지 사진과 질문을 올릴 수 있어요.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="정답표"
          value={String(keyed)}
          unit={`/ ${QUESTION_COUNT}`}
          note={tagged > 0 ? `단원 ${tagged}문항` : '단원은 아직'}
        />
        <Stat label="채점 끝" value={String(gradedCount)} unit={`/ ${board.rows.length}명`} />
        <Stat
          label="질문 제출 · 답 보냄"
          value={`${submittedCount} · ${sentCount}`}
          unit="명"
          note={submittedCount > sentCount ? `${submittedCount - sentCount}명이 답을 기다려요` : undefined}
        />
        <Stat
          label="반 평균"
          value={board.stats.counted ? fmtScore(board.stats.average) : '—'}
          unit={board.stats.counted ? '점' : undefined}
          note={board.stats.counted ? `채점 끝난 ${board.stats.counted}명 · 학생에게는 이 평균만 보여요` : '채점 끝난 학생만'}
        />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        <Card
          title="정답표"
          action={
            <Link href={`/lms/exams/${exam.id}/questions`} className={keyed < QUESTION_COUNT ? btn : btnGhost}>
              {keyed === 0 ? '정답 넣기' : '정답표 고치기'}
            </Link>
          }
        >
          {keyed < QUESTION_COUNT ? (
            <p className="text-[14px] leading-[1.7]">
              정답이 {QUESTION_COUNT - keyed}문항 비어 있어요. 정답이 있어야 학생 답을 넣을 때 저절로 매겨져요.
            </p>
          ) : (
            <p className="text-[14px] leading-[1.7]">
              정답 {keyed}문항이 다 들어 있어요.
              <span className="text-muted">
                {' '}
                {tagged > 0 ? `단원을 붙인 문항 ${tagged}개` : '단원은 아직 안 붙였어요 — 붙이면 단원별 정답률이 쌓여요'}
              </span>
            </p>
          )}
        </Card>

        <Card title={`학생 ${board.rows.length}명`}>
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
                    <th className="num">점수</th>
                    <th className="num">공통 · 미적분</th>
                    <th>틀린 문항</th>
                    <th>채점</th>
                    <th>질문</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <StudentLine
                      key={row.student.id}
                      row={row}
                      rank={board.stats.standings.find((s) => s.studentId === row.student.id)?.rank ?? 0}
                      examId={exam.id}
                      canGrade={questions.length > 0}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            수업이 끝나면 학생마다 &lsquo;채점&rsquo; 을 눌러 걷은 OMR 을 찍어 올리세요. 마킹한 답을 읽어 칸을 채우고, 애매한
            문항은 노랗게 남겨요. 확인하고 저장하면 30문항을 다 매긴 학생은 바로 학생 화면에 점수가 보여요. 학생이 올린
            질문에 답을 다 달고 보내면 답변 PDF 가 학생 메일로 가요.
          </p>
        </Card>

        {pointBars.length > 0 ? (
          <Card title="이 회차 반 평균 정답률">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">배점별</p>
                <RateBars rows={pointBars} labelWidth="w-10" referenceLabel="" />
              </div>
              <div>
                <p className="mb-2 text-[12px] font-extrabold text-muted">단원별</p>
                {unitBars.length > 0 ? (
                  <RateBars rows={unitBars} referenceLabel="" />
                ) : (
                  <p className="text-[13px] leading-[1.6] text-muted">정답표에 단원을 붙이면 여기에 나와요.</p>
                )}
              </div>
            </div>
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
              <label className={label} htmlFor="due_date">답 달 기한 (다음 수업)</label>
              <input id="due_date" name="due_date" type="date" defaultValue={exam.due_date ?? ''} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="status">학생에게</label>
              <select id="status" name="status" defaultValue={exam.status} className={`${input} w-36`}>
                <option value="draft">{EXAM_STATUS.draft}</option>
                <option value="published">{EXAM_STATUS.published}</option>
              </select>
            </div>
            <button type="submit" className={btn}>저장</button>
          </form>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            &lsquo;학생에게 열림&rsquo; 이면 학생이 이 회차에 시험지 사진과 질문을 올리고, 채점이 끝난 자기 점수와 반 평균을 볼
            수 있어요. 점수를 따로 공개하는 단계는 없어요. 답 달 기한은 학생 화면에 &lsquo;이 날 수업 전까지 답을 받아요&rsquo; 로
            보여요.
          </p>

          <form action={removeExam} className="mt-4">
            <input type="hidden" name="exam_id" value={exam.id} />
            <ConfirmSubmit
              className={btnDanger}
              message={`'${exam.title}' 회차를 지웁니다.\n\n정답표, 학생 ${board.rows.filter((r) => r.attempt).length}명의 채점 · 시험지 사진 · 질문과 답변 PDF 가 함께 사라지고 되돌릴 수 없어요.`}
            >
              회차 지우기
            </ConfirmSubmit>
          </form>
        </Card>
      </div>
    </Shell>
  );
}


function StudentLine({
  row,
  rank,
  examId,
  canGrade,
}: {
  row: BoardRow;
  rank: number;
  examId: string;
  canGrade: boolean;
}) {
  const { attempt, score, submission } = row;
  // 0016 시절 학생 사진으로 채우고 아직 아무도 확인하지 않은 채점. 저장하면 선생님 채점이 된다.
  const unconfirmed = attempt?.answers_source === 'photo';

  const gradeState = !attempt || score.graded === 0
    ? '시작 전'
    : unconfirmed
      ? '자동 채점 · 확인 전'
      : !score.complete
        ? `매기는 중 ${score.graded}/${score.count}`
        : '끝';

  const concernState = !attempt || submission.concerns === 0
    ? submission.photos > 0
      ? `사진 ${submission.photos}장 · 질문 없음`
      : '아직 없음'
    : attempt.feedback_ready_at
      ? `보냄 ${seoulStamp(attempt.feedback_ready_at)}`
      : `${attempt.submitted_at ? '제출' : '작성 중'} · 답 ${submission.answered}/${submission.concerns}`;

  return (
    <tr>
      <td className="font-bold">{rank || '—'}</td>
      <td className="font-bold">
        {row.student.name}
        {!row.student.email ? <span className="ml-1 text-[11px] font-bold text-mark">메일 없음</span> : null}
      </td>
      <td className="num font-bold">
        {score.graded > 0 ? (
          <>
            {fmtScore(score.earned)}
            <span className="text-[12px] font-normal text-muted"> / {fmtScore(score.total)}</span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="num text-muted">
        {score.graded > 0 ? score.sections.map((s) => fmtScore(s.earned)).join(' · ') : '—'}
      </td>
      <td className={score.wrongNos.length > 0 ? 'text-mark' : 'text-muted'}>
        {score.graded > 0 ? score.wrongNos.join(', ') || '없음' : '—'}
      </td>
      <td className={unconfirmed ? 'font-bold text-check' : 'text-muted'}>{gradeState}</td>
      <td
        className={
          attempt?.submitted_at && !attempt.feedback_ready_at && submission.answered < submission.concerns
            ? 'font-bold text-mark'
            : attempt?.mail_error
              ? 'font-bold text-danger'
              : 'text-muted'
        }
      >
        {concernState}
        {attempt?.feedback_ready_at && attempt.mail_error ? ' · 메일 안 감' : ''}
      </td>
      <td>
        <div className="flex gap-3">
          <form action={startGrading}>
            <input type="hidden" name="exam_id" value={examId} />
            <input type="hidden" name="student_id" value={row.student.id} />
            <button
              type="submit"
              className="text-[13px] font-bold text-brand underline underline-offset-2 disabled:opacity-40"
              disabled={!canGrade}
            >
              채점
            </button>
          </form>
          <form action={startGrading}>
            <input type="hidden" name="exam_id" value={examId} />
            <input type="hidden" name="student_id" value={row.student.id} />
            <input type="hidden" name="to" value="feedback" />
            <button type="submit" className="text-[13px] font-bold text-brand underline underline-offset-2">
              답 달기
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}
