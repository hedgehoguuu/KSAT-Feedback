import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@/config/lms';
import { isAdmin } from '@/lib/admin';
import { currentUser, lmsSetupProblem } from '@/lib/lms/auth';
import { userCount } from '@/lib/lms/users';
import { login } from '../actions';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  '1': '아이디나 비밀번호가 달라요',
  suspended: '정지된 계정이에요. 선생님께 문의해주세요.',
  setup: '아직 준비가 안 됐어요',
  expired: '로그인이 풀렸어요. 다시 들어와 주세요.',
};

export default async function LmsLogin({ searchParams }: PageProps<'/lms/login'>) {
  const user = await currentUser();
  if (user) redirect(user.must_change_password ? '/lms/password' : ROLE_HOME[user.role]);

  const { error, created, expired } = await searchParams;
  const setupProblem = lmsSetupProblem();

  // 계정이 하나도 없으면 첫 관리자를 만들어야 한다. 그 문은 기존 관리자 잠금이 지킨다.
  const needsBootstrap = !setupProblem && (await userCount()) === 0;
  const key = typeof error === 'string' ? error : expired ? 'expired' : null;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <div className="field" aria-hidden />

      <h1 className="text-[24px] font-bold leading-[1.35]">성적 관리</h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">
        수업에서 본 시험의 점수와 피드백을 보는 곳이에요.
      </p>

      {created ? (
        <p className="mt-5 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          관리자 계정을 만들었어요. 그 아이디로 들어와 주세요.
        </p>
      ) : null}

      {setupProblem ? (
        <div className="glass-solid mt-6 rounded-2xl p-4">
          <p className="text-[15px] font-bold">아직 준비가 안 됐어요</p>
          <p className="mt-1 text-[13px] leading-[1.6] text-muted">
            Vercel → Settings → Environment Variables 에 <span className="font-bold">{setupProblem}</span>
            {' '}를 넣고 다시 배포하면 열려요.
          </p>
        </div>
      ) : (
        <form action={login} className="mt-6 flex flex-col gap-3">
          <input
            name="login_id"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="아이디"
            required
            className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="비밀번호"
            required
            className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
          />
          {/* 오류 자리는 늘 같은 곳이다. 나타났다 사라지며 아래 버튼을 밀지 않게 최소 높이를 준다. */}
          <p className="min-h-5 text-[13px] text-danger" role="alert">
            {key ? MESSAGES[key] ?? MESSAGES['1'] : ''}
          </p>
          <button
            type="submit"
            className="min-h-13 rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
          >
            들어가기
          </button>
        </form>
      )}

      {needsBootstrap ? (
        <p className="mt-6 text-[13px] leading-[1.6] text-muted">
          아직 계정이 하나도 없어요.{' '}
          <Link href={(await isAdmin()) ? '/lms/setup' : '/admin/login'} className="font-bold text-brand underline underline-offset-2">
            첫 관리자 계정 만들기
          </Link>
        </p>
      ) : (
        <p className="mt-6 text-[13px] leading-[1.6] text-muted">
          아이디는 선생님이 만들어 드려요. 잊었다면 선생님께 물어봐 주세요.
        </p>
      )}
    </main>
  );
}
