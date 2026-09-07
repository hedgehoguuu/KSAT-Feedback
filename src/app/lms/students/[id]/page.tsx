import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IntakeCard } from '@/components/lms/IntakeCard';
import { Shell } from '@/components/lms/Shell';
import { StudentReport } from '@/components/lms/StudentReport';
import { ELECTIVES } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { coursesOfStudent, courseVisibleTo } from '@/lib/lms/courses';
import { courseSummary, studentHistory } from '@/lib/lms/exams';
import { findIntake } from '@/lib/lms/intake';
import { getStudent } from '@/lib/lms/users';

export const dynamic = 'force-dynamic';

/** 튜터가 보는 학생 한 명의 누적. 학생 본인 화면과 같은 부품을 쓰되 비공개 회차까지 보인다. */
export default async function StudentDetailPage({ params, searchParams }: PageProps<'/lms/students/[id]'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const { course: fromCourse } = await searchParams;

  const student = await getStudent(id);
  if (!student) notFound();

  // 내 반 학생이 아니면 못 본다. 주소창에 남의 학생 id 를 넣어도 여기서 막힌다.
  const courses = await coursesOfStudent(id);
  const mine = (await Promise.all(courses.map((c) => courseVisibleTo(c.id, me)))).filter(Boolean);
  if (mine.length === 0) notFound();

  /**
   * 어느 반의 눈으로 볼 것인가.
   *
   * 학생이 두 반에 있을 수 있다(국어 반 + 특강). 그때 아무 반이나 골라 '반 평균' 을 그리면
   * 엉뚱한 반의 평균이 기준선이 된다 — 튜터는 자기 반 평균인 줄 알고 읽는다.
   * 그래서 어느 반에서 눌러 들어왔는지를 주소로 받고, 없거나 내 반이 아니면 첫 반으로 둔다.
   */
  const asked = typeof fromCourse === 'string' ? mine.find((c) => c!.id === fromCourse) : undefined;
  const context = asked ?? mine[0]!;

  const [history, summary, intake] = await Promise.all([
    studentHistory(id, { publishedOnly: false }),
    courseSummary(context.id),
    // 9월 시험지 피드백에 적어 준 고민. 접수번호를 안 적었거나 못 찾으면 null 이다.
    findIntake(student.profile?.receipt_no),
  ]);

  return (
    <Shell user={me}>
      <Link
        href={`/lms/courses/${context.id}`}
        className="text-[13px] font-semibold text-muted underline underline-offset-2"
      >
        ← {context.name}
      </Link>

      <h1 className="mt-3 text-[20px] font-extrabold">
        {student.name}
        <span className="ml-2 text-[14px] font-bold text-muted">
          {student.profile?.grade ? `고${student.profile.grade}` : '학년 미정'}
          {student.profile?.elective ? ` · ${ELECTIVES[student.profile.elective]}` : ''}
          {student.profile?.school ? ` · ${student.profile.school}` : ''}
        </span>
      </h1>
      {student.profile?.receipt_no ? (
        <p className="mt-1 text-[13px] text-muted">시험지 피드백 접수번호 {student.profile.receipt_no}</p>
      ) : null}

      <p className="mt-1 text-[13px] text-muted">
        아직 공개하지 않은 회차도 여기서는 보여요. 학생에게는 공개한 것만 보입니다.
        {mine.length > 1 ? ` 반 평균은 ${context.name} 기준이에요.` : ''}
      </p>

      {intake ? (
        <div className="mt-5">
          <IntakeCard intake={intake} />
        </div>
      ) : null}

      <div className="mt-5">
        <StudentReport
          history={history}
          hrefFor={(attemptId) => `/lms/attempts/${attemptId}`}
          classAverages={summary.areaAverages}
          referenceLabel={`${context.name} 평균`}
        />
      </div>
    </Shell>
  );
}
