import Link from 'next/link';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { Card, Empty, Shell, btn, btnDanger, input, label } from '@/components/lms/Shell';
import { COURSE_STATUS } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { listCourses } from '@/lib/lms/courses';
import { listUsers } from '@/lib/lms/users';
import { deleteCourseAction, saveCourseAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AdminCoursesPage({ searchParams }: PageProps<'/lms/admin/courses'>) {
  const me = await requireRole('admin');
  const { error, saved } = await searchParams;

  const [courses, tutors] = await Promise.all([listCourses(), listUsers('tutor')]);

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">반</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        반을 만들고 담당 튜터를 정해요. 수강생과 시험 회차는 반 안에서 튜터가 관리해요.
      </p>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">저장했어요.</p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title="새 반">
          <form action={saveCourseAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <label className={label} htmlFor="name">반 이름</label>
              <input id="name" name="name" required placeholder="목요일 19시 국어 관찰반" className={input} />
            </div>
            <div className="min-w-40">
              <label className={label} htmlFor="tutor_id">담당 튜터</label>
              <select id="tutor_id" name="tutor_id" className={input} defaultValue="">
                <option value="">미배정</option>
                {tutors.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className={btn}>만들기</button>
            {error === 'name' ? (
              <p className="text-[13px] text-danger" role="alert">반 이름을 적어주세요</p>
            ) : null}
          </form>
          {tutors.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              튜터 계정이 아직 없어요.{' '}
              <Link href="/lms/admin" className="font-bold text-brand underline underline-offset-2">
                계정 만들기
              </Link>
            </p>
          ) : null}
        </Card>

        <Card title={`반 ${courses.length}개`}>
          {courses.length === 0 ? (
            <Empty>아직 반이 없어요. 위에서 하나 만들어 주세요.</Empty>
          ) : (
            <ul className="glass-divide flex flex-col">
              {courses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div className="min-w-52 flex-1">
                    <Link href={`/lms/courses/${c.id}`} className="text-[15px] font-bold hover:underline">
                      {c.name}
                    </Link>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {c.tutorName} · 학생 {c.studentCount}명 · 회차 {c.examCount}개 ·{' '}
                      {COURSE_STATUS[c.status]}
                    </p>
                  </div>

                  <form action={saveCourseAction} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="name" value={c.name} />
                    <select name="tutor_id" defaultValue={c.tutor_id ?? ''} className={`${input} w-36`}>
                      <option value="">미배정</option>
                      {tutors.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <select name="status" defaultValue={c.status} className={`${input} w-28`}>
                      <option value="active">진행중</option>
                      <option value="archived">종료</option>
                    </select>
                    <button type="submit" className={btn}>바꾸기</button>
                  </form>

                  <form action={deleteCourseAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <ConfirmSubmit
                      className={btnDanger}
                      message={`'${c.name}' 반을 지웁니다.\n\n시험 회차 ${c.examCount}개와 그 안의 모든 채점 결과가 함께 사라지고 되돌릴 수 없어요.\n학생 계정은 남습니다.\n\n수업이 끝난 반이라면 지우지 말고 '종료'로 바꾸세요.`}
                    >
                      지우기
                    </ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[13px] leading-[1.6] text-muted">
            반을 지우면 그 반의 시험 회차와 채점 결과가 함께 사라져요. 학생 계정은 남아요.
            수업이 끝난 반은 지우지 말고 <span className="font-bold">종료</span>로 바꿔주세요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
