import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnswerKeyEditor } from '@/components/lms/AnswerKeyEditor';
import { Shell } from '@/components/lms/Shell';
import { FULL_SCORE, QUESTION_COUNT, SUBJECT, paperSummary } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { getExam, listQuestions } from '@/lib/lms/exams';
import { ocrConfigured } from '@/lib/lms/ocr';
import { extractAnswerKey, saveAnswerKeyForm } from '../../../course-actions';

export const dynamic = 'force-dynamic';

export default async function AnswerKeyPage({ params, searchParams }: PageProps<'/lms/exams/[id]/questions'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const flags = await searchParams;

  const exam = await getExam(id);
  if (!exam) notFound();
  const course = await courseVisibleTo(exam.course_id, me);
  if (!course) notFound();

  // 줄이 모자란 회차(만들다 끊긴 것)여도 편집기는 1–30 번을 다 보여 주고, 저장하면 빠진 줄이 생긴다.
  const questions = await listQuestions(exam.id);

  const flagged =
    typeof flags.nos === 'string'
      ? flags.nos.split(',').map(Number).filter((n) => Number.isInteger(n))
      : [];

  return (
    <Shell user={me}>
      <Link href={`/lms/exams/${exam.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {exam.title}
      </Link>
      <h1 className="mt-3 text-[20px] font-extrabold">정답표</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        {SUBJECT.name}({SUBJECT.elective}) {QUESTION_COUNT}문항 · {FULL_SCORE}점 · {paperSummary()}. 배점과 문항 구성은
        정해져 있으니 정답만 넣으면 돼요.
      </p>

      {flags.new ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          회차를 만들었어요. 1–{QUESTION_COUNT}번이 깔려 있으니 정답을 넣어주세요 — 정답표 사진을 올리면 채워 드려요.
        </p>
      ) : null}
      {flags.saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          정답표를 저장했어요.
          {Number(flags.regraded) > 0 ? (
            <span className="font-bold">
              {' '}바뀐 정답으로 학생 답 {flags.regraded}개를 다시 매겼어요.
            </span>
          ) : null}
        </p>
      ) : null}
      {flags.error === 'answer' ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          {flagged.join(', ')}번 정답이 맞지 않아 저장하지 않았어요. 5지선다는 1–5, 단답형은 0–999 예요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <AnswerKeyEditor
          action={saveAnswerKeyForm}
          ocrAction={extractAnswerKey}
          ocrConfigured={ocrConfigured()}
          examId={exam.id}
          initial={questions.map((q) => ({ no: q.no, answer: q.answer, unit_code: q.unit_code }))}
          flagged={flags.error === 'answer' ? flagged : []}
        />
      </div>
    </Shell>
  );
}
