import Link from 'next/link';
import { AccountForm } from '@/components/lms/AccountForm';
import { Card, Empty, Shell } from '@/components/lms/Shell';
import { ELECTIVES, LMS, ROLES, USER_STATUS, type Role } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { listStudents, listUsers, type StudentRow } from '@/lib/lms/users';
import { createAccount } from './actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  role: '역할을 골라주세요',
  id: '아이디는 영문 소문자·숫자·(. _ -) 4~32자예요',
  weak: `비밀번호는 ${LMS.minPasswordLength}자 이상이어야 해요`,
  name: '이름을 적어주세요',
  dup: '이미 쓰고 있는 아이디예요',
};

const ROLE_ORDER: Role[] = ['admin', 'tutor', 'student'];

export default async function AdminUsersPage({ searchParams }: PageProps<'/lms/admin'>) {
  const me = await requireRole('admin');
  const { error, made, changed } = await searchParams;

  // 학생은 학년·선택과목까지 한 줄에 보여야 해서 프로필까지 함께 읽는다.
  const [students, admins, tutors] = await Promise.all([
    listStudents(),
    listUsers('admin'),
    listUsers('tutor'),
  ]);
  const byRole: Record<Role, (StudentRow | Awaited<ReturnType<typeof listUsers>>[number])[]> = {
    admin: admins,
    tutor: tutors,
    student: students,
  };

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">계정</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        튜터와 학생 계정을 여기서 만들어요. 아이디와 첫 비밀번호를 정해서 본인에게 알려주면 돼요.
      </p>

      {made ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          <span className="font-bold">{made}</span> 계정을 만들었어요. 첫 비밀번호를 본인에게 알려주세요.
        </p>
      ) : null}
      {changed ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          비밀번호를 바꿨어요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title="새 계정">
          <AccountForm
            action={createAccount}
            error={typeof error === 'string' ? (ERRORS[error] ?? '다시 확인해주세요') : undefined}
          />
        </Card>

        {ROLE_ORDER.map((role) => (
          <Card key={role} title={`${ROLES[role]} ${byRole[role].length}명`}>
            {byRole[role].length === 0 ? (
              <Empty>아직 없어요.</Empty>
            ) : (
              <div className="lms-scroll">
                <table className="lms-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>아이디</th>
                      {role === 'student' ? <th>학년 · 선택</th> : null}
                      {role === 'student' ? <th>접수번호</th> : null}
                      <th>연락처</th>
                      <th>상태</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {byRole[role].map((u) => {
                      const profile = 'profile' in u ? u.profile : null;
                      return (
                        <tr key={u.id}>
                          <td className="font-bold">{u.name}</td>
                          <td className="text-muted">{u.login_id}</td>
                          {role === 'student' ? (
                            <td className="text-muted">
                              {profile?.grade ? `고${profile.grade}` : '—'}
                              {profile?.elective ? ` · ${ELECTIVES[profile.elective]}` : ''}
                            </td>
                          ) : null}
                          {role === 'student' ? (
                            <td className="text-muted">{profile?.receipt_no ?? '—'}</td>
                          ) : null}
                          <td className="text-muted">{u.phone ?? '—'}</td>
                          <td className={u.status === 'active' ? 'text-muted' : 'font-bold text-danger'}>
                            {USER_STATUS[u.status]}
                            {u.must_change_password ? (
                              <span className="ml-1 text-[12px] text-muted">· 첫 로그인 전</span>
                            ) : null}
                          </td>
                          <td>
                            <Link
                              href={`/lms/admin/users/${u.id}`}
                              className="text-[13px] font-bold text-brand underline underline-offset-2"
                            >
                              고치기
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </Shell>
  );
}
