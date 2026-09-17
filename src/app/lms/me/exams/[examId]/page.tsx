import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConcernEditor } from '@/components/lms/ConcernEditor';
import { PaperPhotos } from '@/components/lms/PaperPhotos';
import { ScorePanel } from '@/components/lms/ScorePanel';
import { Card, Shell, btn } from '@/components/lms/Shell';
import { CONCERN, LMS, concernTopic, fmtDay } from '@/config/lms';
import { seoulStamp } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { getCourse, isEnrolled } from '@/lib/lms/courses';
import { findAttempt, getExam, loadGrading } from '@/lib/lms/exams';
import { isAnswered, listConcerns, listPhotos } from '@/lib/lms/feedback';
import { signedUrls } from '@/lib/lms/files';
import { movePaperPhoto, removePaperPhoto, saveMyConcerns, uploadPaperPhoto } from '../../../student-actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  locked: '선생님이 이미 답을 보낸 시험이라 더는 고칠 수 없어요.',
  long: `질문 하나는 ${CONCERN.maxBody}자까지 적을 수 있어요.`,
  topic: '어느 문항인지 고르지 않은 질문이 있어요.',
  empty: '질문을 하나 이상 적어야 제출할 수 있어요.',
};

/**
 * 학생의 시험 한 회차. 시험이 끝나면 여기서 시험지를 올리고 질문을 적고,
 * 답이 오면 여기서 PDF 를 받는다. 점수는 선생님이 공개한 뒤에만 보인다.
 */
export default async function MyExamPage({ params, searchParams }: PageProps<'/lms/me/exams/[examId]'>) {
  const me = await requireRole('student');
  const { examId } = await params;
  const flags = await searchParams;

  // 자기 반의, 학생에게 열린 회차만. 아니면 없는 것과 같이 다룬다 — '있지만 못 본다' 도 정보다.
  const exam = await getExam(examId);
  if (!exam || exam.status !== 'published' || !(await isEnrolled(exam.course_id, me.id))) notFound();

  const [course, attempt] = await Promise.all([getCourse(exam.course_id), findAttempt(exam.id, me.id)]);
  const [photos, concerns] = attempt
    ? await Promise.all([listPhotos(attempt.id), listConcerns(attempt.id)])
    : [[], []];

  const locked = Boolean(attempt?.feedback_ready_at);
  const grading = attempt?.status === 'published' ? await loadGrading(attempt.id) : null;
  const urls = await signedUrls([
    ...photos.map((p) => p.storage_path),
    ...(locked ? concerns.map((c) => c.answer_image_path).filter((p): p is string => Boolean(p)) : []),
  ]);
  const errorKey = typeof flags.error === 'string' ? flags.error : null;

  return (
    <Shell user={me}>
      <Link href="/lms/me" className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← 내 시험
      </Link>
      <h1 className="mt-3 text-[20px] font-extrabold">{exam.title}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {exam.exam_date ? `${fmtDay(exam.exam_date)} 시험` : '날짜 미정'}
        {course ? ` · ${course.name}` : ''}
      </p>

      {/* 무엇이 바뀌었는지는 바로 아래 상태 줄이 말한다. 여기서는 눌린 것만 알린다. */}
      {flags.submitted ? (
        <p className="mt-4 rounded-xl bg-brand/10 px-4 py-3 text-[14px] font-bold text-brand" role="status">
          저장했어요.
        </p>
      ) : null}
      {flags.saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          임시 저장했어요. 다 적으면 &lsquo;제출하기&rsquo; 를 눌러주세요.
        </p>
      ) : null}
      {errorKey ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          {ERRORS[errorKey] ?? '저장하지 못했어요. 다시 해주세요.'}
        </p>
      ) : null}

      {locked && attempt ? (
        <div className="glass-solid mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-4">
          <div>
            <p className="text-[16px] font-extrabold">선생님이 질문 {concerns.length}개에 답을 달았어요</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-muted">
              {seoulStamp(attempt.feedback_ready_at!)}
              {attempt.mailed_at && !attempt.mail_error && attempt.mailed_to ? ` · ${attempt.mailed_to} 로도 보냈어요` : ''}
            </p>
          </div>
          <a href={`/lms/me/exams/${exam.id}/pdf`} className={btn}>
            답변 PDF 받기
          </a>
        </div>
      ) : attempt?.submitted_at ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]">
          <span className="font-bold">제출했어요.</span>{' '}
          {exam.due_date ? `${fmtDay(exam.due_date)} 수업 전까지` : '다음 수업 전까지'} 선생님이 답을 달아요. 그 전까지는 사진과
          질문을 고칠 수 있어요.
        </p>
      ) : (
        <div className="glass-solid mt-4 rounded-2xl px-4 py-4">
          <p className="text-[15px] font-extrabold">시험 끝났나요? 두 가지만 해주세요</p>
          <ol className="mt-2 flex flex-col gap-1 text-[14px] leading-[1.7]">
            <li>① 풀이한 시험지를 찍어 올려요.</li>
            <li>② 문항마다 막혔던 것을 적고 제출해요. 무엇을 떠올리지 못했는지가 가장 좋은 질문이에요.</li>
          </ol>
          <p className="mt-2 text-[13px] text-muted">
            {exam.due_date ? `${fmtDay(exam.due_date)} 수업 전까지` : '다음 수업 전까지'} 선생님이 답을 달아 PDF 로 보내 드려요.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-5">
        {locked ? (
          <Card title="질문과 답">
            <ol className="flex flex-col gap-4">
              {concerns.map((c) => (
                <li key={c.id} className="glass-inset rounded-2xl p-4">
                  <p className="text-[14px] font-extrabold">{concernTopic(c.question_no)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.7] text-muted">{c.body}</p>
                  <p className="mt-3 text-[12px] font-bold text-brand">선생님 답</p>
                  {c.answer ? (
                    <p className="mt-1 whitespace-pre-wrap border-l-2 border-brand pl-3 text-[15px] leading-[1.75]">
                      {c.answer}
                    </p>
                  ) : null}
                  {c.answer_image_path && urls.get(c.answer_image_path) ? (
                    <a href={urls.get(c.answer_image_path)} target="_blank" rel="noreferrer" className="mt-2 block">
                      {/* 비공개 저장소의 임시 주소라 next/image 최적화 대상이 아니다 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urls.get(c.answer_image_path)}
                        alt={`${concernTopic(c.question_no)} 풀이 사진`}
                        className="max-h-96 w-auto rounded-xl border border-line"
                      />
                    </a>
                  ) : c.answer_image_path ? (
                    <p className="mt-2 text-[13px] text-muted">풀이 사진은 PDF 에서 볼 수 있어요.</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        <Card title="시험지 사진">
          <PaperPhotos
            examId={exam.id}
            initial={photos.map((p) => ({ id: p.id, url: urls.get(p.storage_path) ?? null }))}
            locked={locked}
            upload={uploadPaperPhoto}
            remove={removePaperPhoto}
            move={movePaperPhoto}
          />
          {!locked ? (
            <p className="mt-3 text-[12px] leading-[1.6] text-muted">
              {LMS.maxPhotos}장까지 올릴 수 있어요. 사진은 나와 선생님만 볼 수 있어요.
            </p>
          ) : null}
        </Card>

        {!locked ? (
          <Card title="문항별 질문">
            <ConcernEditor
              examId={exam.id}
              action={saveMyConcerns}
              initial={concerns.map((c) => ({ question_no: c.question_no, body: c.body, answered: isAnswered(c) }))}
              submitted={Boolean(attempt?.submitted_at)}
              photoCount={photos.length}
              wrongNos={grading?.score.wrongNos ?? []}
            />
          </Card>
        ) : null}

        {grading ? (
          <ScorePanel
            questions={grading.questions}
            answers={grading.answers}
            score={grading.score}
            overallComment={grading.attempt.overall_comment}
          />
        ) : attempt ? (
          <p className="text-[13px] leading-[1.6] text-muted">점수는 선생님이 채점을 마치면 여기에 나와요.</p>
        ) : null}
      </div>
    </Shell>
  );
}
