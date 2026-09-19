import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GradeSheet } from '@/components/lms/GradeSheet';
import { IntakeCard } from '@/components/lms/IntakeCard';
import { Card, Shell, btnGhost } from '@/components/lms/Shell';
import { requireRole } from '@/lib/lms/auth';
import { listConcerns, progressOf } from '@/lib/lms/concerns';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, loadGrading } from '@/lib/lms/exams';
import { findIntake } from '@/lib/lms/intake';
import { ocrConfigured } from '@/lib/lms/ocr';
import { scoreShown } from '@/lib/lms/score';
import { readOmrForm, submitGrading } from '../../course-actions';

export const dynamic = 'force-dynamic';
// 'OMR 사진으로 채우기' 는 이 화면의 서버 함수 안에서 바로 읽는다. 서버 함수의 시간 상한은 화면의 것을 따른다.
export const maxDuration = 300;

export default async function GradingPage({ params, searchParams }: PageProps<'/lms/attempts/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { saved } = await searchParams;

  const data = await loadGrading(id);
  if (!data) notFound();
  const course = await courseVisibleTo(data.exam.course_id, me);
  if (!course) notFound();

  /**
   * 반 평균을 함께 읽어 막대 옆 눈금으로 준다 — '이 학생이 4점 문항 40%' 만으로는 잘한 건지
   * 알 수 없고, '반이 70% 인데 이 학생이 40%' 여야 무엇을 말해 줄지가 정해진다.
   */
  const [board, intake, concerns] = await Promise.all([
    examBoard(data.exam),
    findIntake(data.student.profile?.receipt_no),
    listConcerns(data.attempt.id),
  ]);
  const progress = progressOf(concerns);
  const examOpen = data.exam.status === 'published';
  const shown = scoreShown(data.attempt, data.score);

  return (
    <Shell user={me}>
      <Link href={`/lms/exams/${data.exam.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {data.exam.title}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-extrabold">
          {data.student.name}
          <span className="ml-2 text-[14px] font-bold text-muted">
            {data.student.profile?.grade ? `고${data.student.profile.grade} · ` : ''}채점
          </span>
        </h1>
        <Link href={`/lms/attempts/${data.attempt.id}/feedback`} className={btnGhost}>
          질문 {progress.total}개 · 답 {progress.answered}개 →
        </Link>
      </div>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          저장했어요.
          {shown ? (examOpen ? ' 학생 화면에 점수가 보여요.' : " 회차를 '학생에게 열림' 으로 바꾸면 학생에게 보여요.") : ''}{' '}
          <Link href={`/lms/exams/${data.exam.id}`} className="font-bold text-brand underline underline-offset-2">
            다음 학생 채점하기
          </Link>
        </p>
      ) : null}

      {/* 0016 시절 학생 사진으로 채우고 아직 아무도 확인하지 않은 채점. 저장하면 선생님 채점이 된다. */}
      {data.attempt.answers_source === 'photo' ? (
        <p className="mt-4 rounded-xl bg-check-soft px-4 py-3 text-[13px] font-bold leading-[1.6] text-check" role="status">
          학생 사진에서 자동으로 채운 채점이 남아 있어요. 아래에서 확인하고 저장해야 학생에게 보여요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        {intake ? <IntakeCard intake={intake} compact /> : null}

        <Card>
          <GradeSheet
            action={submitGrading}
            readOmr={readOmrForm}
            omrConfigured={ocrConfigured()}
            attemptId={data.attempt.id}
            questions={data.questions}
            initialAnswers={data.answers}
            initialOverall={data.attempt.overall_comment ?? ''}
            examOpen={examOpen}
            classAverages={Object.fromEntries(board.stats.partAverages)}
          />
        </Card>
      </div>
    </Shell>
  );
}
