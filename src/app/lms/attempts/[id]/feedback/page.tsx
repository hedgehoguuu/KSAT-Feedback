import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FeedbackAnswers, type ConcernView } from '@/components/lms/FeedbackAnswers';
import { PhotoStrip } from '@/components/lms/PhotoStrip';
import { Card, Empty, Shell, btnGhost } from '@/components/lms/Shell';
import { CONCERN, KINDS, SECTIONS, concernTopic, paperQuestion, unitLabel } from '@/config/lms';
import { fmtDay, fmtScore } from '@/lib/format';
import { seoulDate, seoulStamp } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { listConcerns } from '@/lib/lms/concerns';
import { courseVisibleTo } from '@/lib/lms/courses';
import { loadGrading } from '@/lib/lms/exams';
import { mailErrorText } from '@/lib/lms/feedback';
import { signedUrls } from '@/lib/lms/files';
import { listPhotos } from '@/lib/lms/photos';
import { removeAnswerImage, saveFeedbackAnswers, uploadAnswerImage } from '../../../course-actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  UNANSWERED: '아직 답을 안 단 질문이 있어 보내지 않았어요.',
  CHANGED: '그사이 학생이 질문을 바꿨어요. 새 질문을 확인하고 다시 보내주세요.',
  REGRADED: '보내는 사이 채점이 바뀌었어요(학생이 사진을 바꾸면 사진으로 매긴 채점이 비워져요). 점수를 확인하고 다시 보내주세요.',
  NO_CONCERNS: '학생 질문이 하나도 없어 보낼 것이 없어요.',
  NOT_FOUND: '이 응시를 찾지 못했어요.',
  long: `답이 너무 길어요. 한 질문에 ${CONCERN.maxAnswer}자까지예요.`,
};

const MAIL: Record<string, string> = {
  SENT: '학생 메일로도 보냈어요.',
  NO_EMAIL: '학생 계정에 메일 주소가 없어 메일은 안 갔어요. 학생 화면에서 받을 수 있어요.',
  NOT_CONFIGURED: '메일 설정이 없어 메일은 안 갔어요. 학생 화면에서 받을 수 있어요.',
  FAILED: '메일은 실패했어요. 학생 화면에서는 받을 수 있어요 — 아래에 이유가 있어요.',
};

export default async function FeedbackPage({ params, searchParams }: PageProps<'/lms/attempts/[id]/feedback'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const flags = await searchParams;

  const data = await loadGrading(id);
  if (!data) notFound();
  const course = await courseVisibleTo(data.exam.course_id, me);
  if (!course) notFound();
  const { attempt, exam, student, questions, answers, score } = data;

  const [photos, concerns] = await Promise.all([listPhotos(attempt.id), listConcerns(attempt.id)]);
  const urls = await signedUrls([
    ...photos.map((p) => p.storage_path),
    ...concerns.map((c) => c.answer_image_path).filter((p): p is string => Boolean(p)),
  ]);

  const byNo = new Map(questions.map((q) => [q.no, q]));
  const marks = new Map(answers.map((a) => [a.question_id, a.correct]));
  const views: ConcernView[] = concerns.map((c) => {
    const q = byNo.get(c.question_no);
    const paper = paperQuestion(c.question_no);
    const marked = q ? marks.get(q.id) : undefined;
    return {
      id: c.id,
      topic: concernTopic(c.question_no),
      meta: paper
        ? [SECTIONS[paper.section], KINDS[paper.kind], `${paper.points}점`, q?.unit_code ? unitLabel(q.unit_code) : null]
            .filter(Boolean)
            .join(' · ')
        : '어느 한 문항이 아닌 이야기',
      mark: marked === undefined ? null : marked ? 'o' : 'x',
      body: c.body,
      answer: c.answer ?? '',
      imageUrl: c.answer_image_path ? (urls.get(c.answer_image_path) ?? null) : null,
      hasImage: Boolean(c.answer_image_path),
      // 제출한 뒤에 학생이 고치거나 더한 질문. 이미 읽었다고 넘기지 않게 짚는다.
      updatedLate: Boolean(attempt.submitted_at && Date.parse(c.updated_at) > Date.parse(attempt.submitted_at)),
    };
  });

  const today = seoulDate();
  const daysLeft = exam.due_date
    ? Math.round((Date.parse(`${exam.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    : null;
  const mailProblem = attempt.feedback_ready_at ? mailErrorText(attempt.mail_error) : null;
  const errorKey = typeof flags.error === 'string' ? flags.error : null;

  return (
    <Shell user={me}>
      <Link href={`/lms/exams/${exam.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {exam.title}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-extrabold">
          {student.name}
          <span className="ml-2 text-[14px] font-bold text-muted">질문 답변</span>
        </h1>
        <Link href={`/lms/attempts/${attempt.id}`} className={btnGhost}>
          {score.complete ? `채점 ${fmtScore(score.earned)}점` : score.graded > 0 ? '채점 이어서 하기' : '채점하기'} →
        </Link>
      </div>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        {attempt.submitted_at ? `${seoulStamp(attempt.submitted_at)} 제출` : '아직 제출 전이에요 — 학생이 적는 중이라 바뀔 수 있어요'}
        {exam.due_date ? (
          <span className={daysLeft !== null && daysLeft < 0 && !attempt.feedback_ready_at ? 'font-bold text-mark' : ''}>
            {' · '}답 달 기한 {fmtDay(exam.due_date)}
            {!attempt.feedback_ready_at && daysLeft !== null
              ? daysLeft > 0
                ? ` (${daysLeft}일 남음)`
                : daysLeft === 0
                  ? ' (오늘)'
                  : ` (${-daysLeft}일 지남)`
              : ''}
          </span>
        ) : null}
        {student.email ? ` · 메일 ${student.email}` : ''}
      </p>

      {flags.saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">저장했어요.</p>
      ) : null}
      {flags.sent ? (
        <p className="mt-4 rounded-xl bg-brand/10 px-4 py-3 text-[14px] font-bold leading-[1.6] text-brand" role="status">
          답변 PDF 를 보냈어요. {MAIL[String(flags.mail)] ?? ''}
          {flags.published ? ' 채점이 끝나 있어 학생 화면에도 점수를 열었어요.' : ''}
        </p>
      ) : null}
      {errorKey ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold leading-[1.6] text-mark" role="alert">
          {ERRORS[errorKey] ?? '보내지 못했어요. 다시 해주세요.'}
          {typeof flags.missing === 'string'
            ? ` 남은 것: ${flags.missing
                .split(',')
                .map((n) => concernTopic(Number(n)))
                .join(', ')}`
            : ''}
        </p>
      ) : null}

      {attempt.feedback_ready_at ? (
        <div className="glass-solid mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <p className="text-[14px] leading-[1.6]">
            <span className="font-bold">{seoulStamp(attempt.feedback_ready_at)}</span>에 답변 PDF 를 보냈어요.
            {attempt.mailed_at && !attempt.mail_error ? (
              <span className="text-muted"> {attempt.mailed_to} 로 메일이 갔어요.</span>
            ) : null}
            {mailProblem ? <span className="block font-bold text-danger">{mailProblem}</span> : null}
          </p>
          <a href={`/lms/attempts/${attempt.id}/pdf?sent=1`} className={btnGhost} target="_blank" rel="noreferrer">
            보낸 PDF 보기
          </a>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title={`시험지 사진 ${photos.length}장`}>
          <PhotoStrip
            photos={photos.map((p) => ({ id: p.id, url: urls.get(p.storage_path) ?? null }))}
            empty="학생이 아직 시험지 사진을 올리지 않았어요."
          />
        </Card>

        <Card title="PDF 에 들어가는 것">
          <ul className="flex flex-col gap-1.5 text-[14px] leading-[1.6]">
            <li>
              <span className="font-bold">질문과 답 {concerns.length}개</span>
              <span className="text-muted"> — 문항 순서대로, &lsquo;시험 전체&rsquo; 는 맨 뒤에</span>
            </li>
            <li>
              <span className="font-bold">점수와 정오표</span>{' '}
              {score.complete ? (
                <span className="text-muted">
                  — {fmtScore(score.earned)}점 · 틀린 문항 {score.wrongNos.join(', ') || '없음'}.
                  {attempt.status !== 'published' ? ' 보내면 학생 화면에도 점수가 열려요.' : ''}
                  {attempt.answers_source === 'photo' && attempt.status !== 'published' ? (
                    <span className="font-bold text-check">
                      {' '}사진으로 자동 채점한 점수예요 —{' '}
                      <Link href={`/lms/attempts/${attempt.id}`} className="underline underline-offset-2">
                        채점 화면에서 확인하기
                      </Link>
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-mark">
                  — 채점이 끝나지 않아 빠져요 ({score.graded}/{score.count}).{' '}
                  <Link href={`/lms/attempts/${attempt.id}`} className="underline underline-offset-2">
                    채점하기
                  </Link>
                </span>
              )}
            </li>
            <li>
              <span className="font-bold">선생님 총평</span>{' '}
              <span className="text-muted">
                {attempt.overall_comment?.trim() ? '— 채점 화면에 적은 총평이 들어가요' : '— 적은 총평이 없어요 (채점 화면에서 적어요)'}
              </span>
            </li>
          </ul>
        </Card>

        {concerns.length === 0 ? (
          <Card>
            <Empty>
              학생이 아직 질문을 올리지 않았어요.
              <br />
              {exam.status === 'published'
                ? '학생 화면의 이 시험에서 사진과 질문을 올리면 여기에 나와요.'
                : '회차가 아직 ‘준비 중’ 이라 학생이 올릴 수 없어요. 회차 화면에서 ‘학생에게 열림’ 으로 바꿔주세요.'}
            </Empty>
          </Card>
        ) : (
          <FeedbackAnswers
            attemptId={attempt.id}
            action={saveFeedbackAnswers}
            uploadImage={uploadAnswerImage}
            removeImage={removeAnswerImage}
            concerns={views}
            sentAt={attempt.feedback_ready_at ? seoulStamp(attempt.feedback_ready_at) : null}
            studentName={student.name}
            mailTo={student.email}
            previewHref={`/lms/attempts/${attempt.id}/pdf`}
            scored={score.complete}
          />
        )}
      </div>
    </Shell>
  );
}
