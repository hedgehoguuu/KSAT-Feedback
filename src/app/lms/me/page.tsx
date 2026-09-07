import Link from 'next/link';
import { Card, Empty, Shell } from '@/components/lms/Shell';
import { StudentReport } from '@/components/lms/StudentReport';
import { ELECTIVES } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { coursesOfStudent } from '@/lib/lms/courses';
import { studentHistory } from '@/lib/lms/exams';
import { getStudent } from '@/lib/lms/users';

export const dynamic = 'force-dynamic';

export default async function StudentHome({ searchParams }: PageProps<'/lms/me'>) {
  const me = await requireRole('student');
  const { changed } = await searchParams;

  const [student, courses, history] = await Promise.all([
    getStudent(me.id),
    coursesOfStudent(me.id),
    // 공개한 회차만. 채점 도중의 반쪽짜리 점수가 학생에게 보이면 안 된다.
    studentHistory(me.id, { publishedOnly: true }),
  ]);

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">{me.name} 학생</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        {courses.length > 0 ? courses.map((c) => c.name).join(' · ') : '아직 등록된 반이 없어요'}
        {student?.profile?.elective ? ` · ${ELECTIVES[student.profile.elective]}` : ''}
      </p>

      {changed ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          비밀번호를 바꿨어요.
        </p>
      ) : null}

      <div className="mt-5">
        {history.points.length === 0 ? (
          <Card>
            <Empty>
              아직 볼 수 있는 회차가 없어요.
              <br />
              시험을 보고 선생님이 채점을 마치면 여기에 쌓여요.
            </Empty>
          </Card>
        ) : (
          <StudentReport history={history} hrefFor={(attemptId) => `/lms/me/${attemptId}`} />
        )}
      </div>

      <p className="mt-6 text-[13px] leading-[1.6] text-muted">
        점수가 이상하거나 안 보이는 회차가 있으면 선생님께 말해주세요.{' '}
        <Link href="/lms/password" className="font-bold text-brand underline underline-offset-2">
          비밀번호 바꾸기
        </Link>
      </p>
    </Shell>
  );
}
