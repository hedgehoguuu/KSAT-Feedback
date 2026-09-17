import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { RateBars, classBarsOf } from '@/components/lms/RateBars';
import { Card, Empty, Shell, Stat, btn, btnDanger, btnGhost, input, label } from '@/components/lms/Shell';
import { EXAM_STATUS, QUESTION_COUNT, fmtDay, fmtScore } from '@/config/lms';
import { seoulDate, seoulStamp } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, getExam, type BoardRow } from '@/lib/lms/exams';
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

  const board = await examBoard(exam);
  const { questions } = board;
  const keyed = questions.filter((q) => q.answer !== null).length;
  const tagged = questions.filter((q) => q.unit_code).length;
  const gradedCount = board.rows.filter((r) => r.score.complete).length;
  const submittedCount = board.rows.filter((r) => r.attempt?.submitted_at).length;
  const sentCount = board.rows.filter((r) => r.attempt?.feedback_ready_at).length;
  const today = seoulDate();
  const overdue = Boolean(exam.due_date && exam.due_date < today);

  const done = board.rows.filter((r) => r.score.complete);
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
      {published !== undefined ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          {Number(published) > 0 ? `${published}명의 점수를 공개했어요.` : '새로 공개할 학생이 없었어요.'}
          {Number(skipped) > 0 ? (
            <span className="text-muted">
              {' '}채점이 아직 안 끝난 {skipped}명은 그대로 뒀어요 — 반쪽짜리 점수는 공개하지 않아요.
            </span>
          ) : null}
          {exam.status === 'draft' && Number(published) > 0 ? (
            <span className="mt-1 block font-bold text-danger">
              회차가 아직 &lsquo;준비 중&rsquo; 이라 학생에게는 안 보여요. 아래에서 &lsquo;학생에게 열림&rsquo; 으로 바꿔주세요.
            </span>
          ) : null}
        </p>
      ) : null}
      {exam.status === 'draft' ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[13px] font-bold leading-[1.6] text-mark">
          아직 학생에게 안 보이는 회차예요. 시험을 본 뒤 아래 &lsquo;회차 정보&rsquo; 에서 &lsquo;학생에게 열림&rsquo; 으로
          바꾸면 학생들이 시험지 사진과 질문을 올릴 수 있어요.
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
          note={
            board.stats.counted
              ? `최고 ${fmtScore(board.stats.highest)} · 최저 ${fmtScore(board.stats.lowest)}`
              : '채점 끝난 학생만'
          }
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

        <Card
          title={`학생 ${board.rows.length}명`}
          action={
            <form action={publishExamGrades}>
              <input type="hidden" name="exam_id" value={exam.id} />
              <button type="submit" className={btnGhost} disabled={gradedCount === 0}>
                채점 끝난 {gradedCount}명 점수 공개
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
            학생이 올린 질문에 답을 다 달고 보내면 답변 PDF 가 학생 메일로 가요. 채점이 끝났으면 점수도 PDF 에 들어가고,
            그때 학생 화면에도 점수가 열려요.
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
            &lsquo;학생에게 열림&rsquo; 이면 학생이 이 회차에 시험지 사진과 질문을 올릴 수 있어요. 점수는 따로 —
            채점 화면에서 &lsquo;저장하고 점수 공개&rsquo; 를 누르거나 답변 PDF 를 보내야 그 학생에게 보여요.
            답 달 기한은 학생 화면에 &lsquo;이 날 수업 전까지 답을 받아요&rsquo; 로 보여요.
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
  const gradeState = !attempt || score.graded === 0
    ? '시작 전'
    : !score.complete
      ? `매기는 중 ${score.graded}/${score.count}`
      : attempt.status === 'published'
        ? '공개함'
        : '끝 · 비공개';

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
      <td className="text-muted">{gradeState}</td>
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
