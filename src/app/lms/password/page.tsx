import { redirect } from 'next/navigation';
import { LMS, ROLE_HOME } from '@/config/lms';
import { currentUser } from '@/lib/lms/auth';
import { changePassword } from '../actions';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  current: '지금 비밀번호가 달라요',
  weak: `새 비밀번호는 ${LMS.minPasswordLength}자 이상이어야 해요`,
  mismatch: '새 비밀번호 두 칸이 서로 달라요',
  same: '지금 쓰는 비밀번호와 같아요',
};

/**
 * 비밀번호 변경.
 *
 * requireRole 을 쓰지 않는다 — requireRole 은 '아직 비밀번호를 안 바꾼 사람' 을
 * 이 화면으로 보내므로, 이 화면이 그걸 다시 부르면 제자리를 맴돈다.
 */
export default async function ChangePasswordPage({ searchParams }: PageProps<'/lms/password'>) {
  const user = await currentUser();
  if (!user) redirect('/lms/login');

  const { error } = await searchParams;
  const forced = user.must_change_password;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <div className="field" aria-hidden />

      <h1 className="text-[24px] font-bold leading-[1.35]">
        {forced ? '비밀번호를 바꿔주세요' : '비밀번호 바꾸기'}
      </h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">
        {forced
          ? '처음 받은 비밀번호는 선생님도 알고 있어요. 나만 아는 것으로 바꿔야 들어갈 수 있어요.'
          : `${LMS.minPasswordLength}자 이상으로 정해주세요.`}
      </p>

      <form action={changePassword} className="mt-6 flex flex-col gap-3">
        {/* 브라우저 비밀번호 관리자가 어느 계정인지 알아보게 하는 숨은 칸이다. */}
        <input type="text" name="username" autoComplete="username" defaultValue={user.login_id} hidden readOnly />
        <input
          type="password"
          name="current"
          autoComplete="current-password"
          placeholder="지금 비밀번호"
          required
          className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
        />
        <input
          type="password"
          name="next"
          autoComplete="new-password"
          placeholder="새 비밀번호"
          required
          className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
        />
        <input
          type="password"
          name="again"
          autoComplete="new-password"
          placeholder="새 비밀번호 한 번 더"
          required
          className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
        />
        <p className="min-h-5 text-[13px] text-danger" role="alert">
          {typeof error === 'string' ? MESSAGES[error] ?? '다시 확인해주세요' : ''}
        </p>
        <button
          type="submit"
          className="min-h-13 rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
        >
          바꾸기
        </button>
      </form>

      {!forced ? (
        <a href={ROLE_HOME[user.role]} className="mt-6 text-[13px] font-semibold text-muted underline underline-offset-2">
          그냥 돌아가기
        </a>
      ) : null}
    </main>
  );
}
