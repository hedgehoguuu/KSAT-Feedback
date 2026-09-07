import Link from 'next/link';
import { Card, Empty, Shell } from '@/components/lms/Shell';
import { COURSE_STATUS } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { listCourses } from '@/lib/lms/courses';

export const dynamic = 'force-dynamic';

export default async function TutorHome() {
  const me = await requireRole('tutor', 'admin');

  // 관리자가 들어오면 전체 반을 본다. 튜터는 자기 반만.
  const courses = await listCourses(me.role === 'tutor' ? me.id : undefined);

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">내 반</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        반을 열면 수강생과 시험 회차가 나와요.
      </p>

      <div className="mt-5">
        <Card>
          {courses.length === 0 ? (
            <Empty>
              아직 맡은 반이 없어요.
              {me.role === 'admin' ? (
                <>
                  {' '}
                  <Link href="/lms/admin/courses" className="font-bold text-brand underline underline-offset-2">
                    반 만들기
                  </Link>
                </>
              ) : (
                ' 관리자에게 배정을 부탁해주세요.'
              )}
            </Empty>
          ) : (
            <ul className="glass-divide flex flex-col">
              {courses.map((c) => (
                <li key={c.id} className="py-3 first:pt-0">
                  <Link href={`/lms/courses/${c.id}`} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-bold">{c.name}</p>
                      <p className="mt-0.5 text-[13px] text-muted">
                        학생 {c.studentCount}명 · 회차 {c.examCount}개 · {COURSE_STATUS[c.status]}
                        {me.role === 'admin' ? ` · ${c.tutorName}` : ''}
                      </p>
                    </div>
                    <span className="text-[13px] font-bold text-brand">열기 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
