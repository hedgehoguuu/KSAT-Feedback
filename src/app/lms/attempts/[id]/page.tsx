import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GradeSheet } from '@/components/lms/GradeSheet';
import { IntakeCard } from '@/components/lms/IntakeCard';
import { PhotoStrip } from '@/components/lms/PhotoStrip';
import { Card, Shell, btnGhost } from '@/components/lms/Shell';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { examBoard, loadGrading } from '@/lib/lms/exams';
import { listConcerns, listPhotos, progressOf } from '@/lib/lms/feedback';
import { signedUrls } from '@/lib/lms/files';
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
   * 반 평균을 함께 읽어 막대 옆 눈금으로 준다 — '이 학생이 4점 문항 40%' 만으로는 잘한 건지
   * 알 수 없고, '반이 70% 인데 이 학생이 40%' 여야 무엇을 말해 줄지가 정해진다.
   */
  const [board, intake, photos, concerns] = await Promise.all([
    examBoard(data.exam),
    findIntake(data.student.profile?.receipt_no),
    listPhotos(data.attempt.id),
    listConcerns(data.attempt.id),
  ]);
  const urls = await signedUrls(photos.map((p) => p.storage_path));
  const progress = progressOf(concerns);

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
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          저장했어요.{' '}
          <Link href={`/lms/exams/${data.exam.id}`} className="font-bold text-brand underline underline-offset-2">
            다음 학생 채점하기
          </Link>
        </p>
      ) : null}

      {/* 학생에게는 채점과 회차가 둘 다 공개여야 보인다. 채점만 공개하고 안심하지 않게. */}
      {data.exam.status === 'draft' && data.attempt.status === 'published' ? (
        <p className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-[13px] leading-[1.6] text-danger" role="status">
          점수는 공개했지만 회차가 아직 &lsquo;준비 중&rsquo; 이라 학생에게는 안 보여요.{' '}
          <Link href={`/lms/exams/${data.exam.id}`} className="font-bold underline underline-offset-2">
            회차에서 바꾸기
          </Link>
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title={`시험지 사진 ${photos.length}장`}>
          <PhotoStrip
            photos={photos.map((p) => ({ id: p.id, url: urls.get(p.storage_path) ?? null }))}
            empty="학생이 아직 시험지 사진을 올리지 않았어요. 종이 시험지를 보고 매겨도 돼요."
          />
        </Card>

        {intake ? <IntakeCard intake={intake} compact /> : null}

        <Card>
          <GradeSheet
            action={submitGrading}
            attemptId={data.attempt.id}
            questions={data.questions}
            initialAnswers={data.answers}
            initialOverall={data.attempt.overall_comment ?? ''}
            initialStatus={data.attempt.status}
            classAverages={Object.fromEntries(board.stats.partAverages)}
          />
        </Card>
      </div>
    </Shell>
  );
}
