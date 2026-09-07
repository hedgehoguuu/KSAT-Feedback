import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GradeSheet } from '@/components/lms/GradeSheet';
import { IntakeCard } from '@/components/lms/IntakeCard';
import { Card, Shell } from '@/components/lms/Shell';
import { ELECTIVES } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, loadGrading } from '@/lib/lms/exams';
import { findIntake } from '@/lib/lms/intake';
import { submitGrading } from '../../course-actions';

export const dynamic = 'force-dynamic';

export default async function GradingPage({ params, searchParams }: PageProps<'/lms/attempts/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { saved } = await searchParams;

  const data = await loadGrading(id);
  if (!data) notFound();
  const course = await courseVisibleTo(data.exam.course_id, me);
  if (!course) notFound();

  /**
   * 반 평균을 함께 읽어 막대 옆 눈금으로 준다 — '이 학생이 40%' 만으로는 잘한 건지 알 수 없고,
   * '반이 70% 인데 이 학생이 40%' 여야 무엇을 말해 줄지가 정해진다.
   */
  const [board, intake] = await Promise.all([
    examBoard(data.exam),
    findIntake(data.student.profile?.receipt_no),
  ]);
  const classAverages = Object.fromEntries(board.stats.areaAverages);

  return (
    <Shell user={me}>
      <Link href={`/lms/exams/${data.exam.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {data.exam.title}
      </Link>

      <h1 className="mt-3 text-[20px] font-extrabold">
        {data.student.name}
        <span className="ml-2 text-[14px] font-bold text-muted">
          {data.student.profile?.grade ? `고${data.student.profile.grade} · ` : ''}
          {data.attempt.elective ? ELECTIVES[data.attempt.elective] : '선택과목 미정'}
        </span>
      </h1>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          저장했어요.{' '}
          <Link href={`/lms/exams/${data.exam.id}`} className="font-bold text-brand underline underline-offset-2">
            다음 학생 채점하기
          </Link>
        </p>
      ) : null}

      {intake ? (
        <div className="mt-5">
          <IntakeCard intake={intake} compact />
        </div>
      ) : null}

      <div className="mt-5">
        <Card>
          <GradeSheet
            action={submitGrading}
            attemptId={data.attempt.id}
            questions={data.questions}
            initialAnswers={data.answers}
            initialElective={data.attempt.elective}
            initialComments={Object.fromEntries(data.areaComments)}
            initialOverall={data.attempt.overall_comment ?? ''}
            initialStatus={data.attempt.status}
            studentElective={data.student.profile?.elective ?? null}
            classAverages={classAverages}
          />
        </Card>
      </div>
    </Shell>
  );
}
