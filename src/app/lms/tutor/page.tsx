import Link from 'next/link';
import { Card, Empty, Shell } from '@/components/lms/Shell';
import { COURSE_STATUS } from '@/config/lms';
import { fmtDay } from '@/lib/format';
import { seoulDate, seoulStamp } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { listCourses } from '@/lib/lms/courses';
import { pendingFeedback } from '@/lib/lms/lists';

export const dynamic = 'force-dynamic';

export default async function TutorHome() {
  const me = await requireRole('tutor', 'admin');

  // 관리자가 들어오면 전체 반을 본다. 튜터는 자기 반만.
  const courses = await listCourses(me.role === 'tutor' ? me.id : undefined);
  // 끝난 반의 질문까지 할 일로 세면 목록이 줄지 않는다. 진행 중인 반만 본다.
  const pending = await pendingFeedback(courses.filter((c) => c.status === 'active').map((c) => c.id));
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const today = seoulDate();

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">내 반</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        학생이 시험 뒤에 올린 질문은 다음 수업 전까지 답을 달아 주세요. 다 달고 보내면 학생에게 PDF 로 가요.
      </p>

      <div className="mt-5 flex flex-col gap-5">
        <Card title={pending.length > 0 ? `답을 기다리는 학생 ${pending.length}명` : '답을 기다리는 학생'}>
          {pending.length === 0 ? (
            <Empty>지금 답을 기다리는 질문이 없어요.</Empty>
          ) : (
            <ul className="glass-divide flex flex-col">
              {pending.map((item) => {
                const late = Boolean(item.exam.due_date && item.exam.due_date < today);
                const dueToday = item.exam.due_date === today;
                return (
                  <li key={item.attempt.id} className="py-3 first:pt-0">
                    <Link
                      href={`/lms/attempts/${item.attempt.id}/feedback`}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold">
                          {item.studentName}
                          <span className="ml-2 text-[13px] font-bold text-muted">{item.exam.title}</span>
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted">
                          {courses.length > 1 ? `${courseName.get(item.courseId)} · ` : ''}
                          {item.attempt.submitted_at ? `${seoulStamp(item.attempt.submitted_at)} 제출 · ` : ''}
                          질문 {item.counts.concerns}개 중 {item.counts.answered}개 답함 · 사진 {item.counts.photos}장
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold ${
                          late || dueToday ? 'bg-mark-soft text-mark' : 'bg-surface text-muted'
                        }`}
                      >
                        {item.exam.due_date
                          ? `${fmtDay(item.exam.due_date)}까지${late ? ' · 지났어요' : dueToday ? ' · 오늘' : ''}`
                          : '기한 없음'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="반">
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
