import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Shell, btn, btnDanger, btnGhost, input, label } from '@/components/lms/Shell';
import { ELECTIVES, ELECTIVE_LIST, LMS, ROLES } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { getStudent, getUser } from '@/lib/lms/users';
import { deleteAccount, resetAccountPassword, setAccountStatus, updateAccount } from '../../actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  weak: `비밀번호는 ${LMS.minPasswordLength}자 이상이어야 해요`,
  self: '자기 계정은 정지하거나 지울 수 없어요',
  inuse: '이 튜터가 맡은 반이 있어요. 반의 담당을 먼저 옮겨주세요.',
};

export default async function AccountDetailPage({ params, searchParams }: PageProps<'/lms/admin/users/[id]'>) {
  const me = await requireRole('admin');
  const { id } = await params;
  const { error, saved, reset } = await searchParams;

  const user = await getUser(id);
  if (!user) notFound();

  const student = user.role === 'student' ? await getStudent(id) : null;
  const profile = student?.profile ?? null;

  return (
    <Shell user={me}>
      <Link href="/lms/admin" className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← 계정 목록
      </Link>

      <h1 className="mt-3 text-[20px] font-extrabold">
        {user.name}
        <span className="ml-2 text-[14px] font-bold text-muted">
          {ROLES[user.role]} · {user.login_id}
        </span>
      </h1>

      {saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          저장했어요.
        </p>
      ) : null}
      {reset ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          비밀번호를 새로 발급했어요. 본인에게 알려주세요 — 처음 들어올 때 다시 바꾸게 돼요.
        </p>
      ) : null}
      {typeof error === 'string' ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          {ERRORS[error] ?? '다시 확인해주세요'}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title="정보">
          <form action={updateAccount} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="role" value={user.role} />

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={label} htmlFor="name">이름</label>
                <input id="name" name="name" defaultValue={user.name} required className={input} />
              </div>
              <div>
                <label className={label} htmlFor="phone">연락처</label>
                <input id="phone" name="phone" defaultValue={user.phone ?? ''} inputMode="tel" className={input} />
              </div>
              <div>
                <label className={label} htmlFor="email">이메일</label>
                <input id="email" name="email" type="email" defaultValue={user.email ?? ''} className={input} />
              </div>
            </div>

            {user.role === 'student' ? (
              <div className="glass-inset grid gap-3 rounded-xl p-3 sm:grid-cols-5">
                <div>
                  <label className={label} htmlFor="grade">학년</label>
                  <select id="grade" name="grade" defaultValue={profile?.grade ?? ''} className={input}>
                    <option value="">—</option>
                    <option value="1">고1</option>
                    <option value="2">고2</option>
                    <option value="3">고3</option>
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="elective">선택과목</label>
                  <select id="elective" name="elective" defaultValue={profile?.elective ?? ''} className={input}>
                    <option value="">—</option>
                    {ELECTIVE_LIST.map((e) => (
                      <option key={e} value={e}>{ELECTIVES[e]}</option>
                    ))}
                  </select>
                  {/* 바꿔도 이미 매긴 회차의 채점은 그대로다 — 응시할 때의 선택과목을 따로 적어 뒀다. */}
                  <p className="mt-1 text-[12px] text-muted">지난 회차 채점은 그대로예요</p>
                </div>
                <div>
                  <label className={label} htmlFor="school">학교</label>
                  <input id="school" name="school" defaultValue={profile?.school ?? ''} className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="parent_phone">학부모 연락처</label>
                  <input
                    id="parent_phone"
                    name="parent_phone"
                    defaultValue={profile?.parent_phone ?? ''}
                    inputMode="tel"
                    className={input}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="receipt_no">접수번호</label>
                  <input
                    id="receipt_no"
                    name="receipt_no"
                    defaultValue={profile?.receipt_no ?? ''}
                    placeholder="F0902-013"
                    className={input}
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className={label} htmlFor="memo">메모</label>
                  <input id="memo" name="memo" defaultValue={profile?.memo ?? ''} className={input} />
                </div>
              </div>
            ) : null}

            <div>
              <button type="submit" className={btn}>저장</button>
            </div>
          </form>
        </Card>

        <Card title="비밀번호 새로 발급">
          <p className="mb-3 text-[13px] leading-[1.6] text-muted">
            지금 비밀번호는 볼 수 없어요 — 되돌릴 수 없게 저장돼 있어서예요.
            잊어버렸다면 새로 정해서 알려주세요.
          </p>
          <form action={resetAccountPassword} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={user.id} />
            <div className="min-w-52 flex-1">
              <label className={label} htmlFor="password">새 비밀번호</label>
              <input
                id="password"
                name="password"
                required
                minLength={LMS.minPasswordLength}
                placeholder={`${LMS.minPasswordLength}자 이상`}
                className={input}
              />
            </div>
            <button type="submit" className={btnGhost}>발급</button>
          </form>
        </Card>

        <Card title="계정 잠그기">
          <div className="flex flex-wrap items-center gap-3">
            <form action={setAccountStatus}>
              <input type="hidden" name="id" value={user.id} />
              <input type="hidden" name="status" value={user.status === 'active' ? 'suspended' : 'active'} />
              <button type="submit" className={btnGhost} disabled={user.id === me.id}>
                {user.status === 'active' ? '정지시키기' : '다시 열기'}
              </button>
            </form>

            <form action={deleteAccount}>
              <input type="hidden" name="id" value={user.id} />
              <button type="submit" className={btnDanger} disabled={user.id === me.id}>
                계정 지우기
              </button>
            </form>
          </div>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            정지시키면 로그인만 막히고 성적은 그대로 남아요. 지우면 이 학생의 응시 기록과 피드백이
            함께 사라지고 되돌릴 수 없어요 — 대개는 정지가 맞아요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
