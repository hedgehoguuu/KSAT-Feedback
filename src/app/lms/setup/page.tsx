import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LMS } from '@/config/lms';
import { requireAdmin } from '@/lib/admin';
import { lmsSetupProblem } from '@/lib/lms/auth';
import { userCount } from '@/lib/lms/users';
import { bootstrapAdmin } from '../actions';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  id: `아이디는 영문 소문자·숫자·(. _ -) 4~32자예요`,
  weak: `비밀번호는 ${LMS.minPasswordLength}자 이상이어야 해요`,
  name: '이름을 적어주세요',
  dup: '이미 쓰고 있는 아이디예요',
};

/**
 * 첫 관리자 계정 만들기.
 *
 * 계정을 만들려면 관리자여야 하는데 관리자가 아직 없다 — 그 매듭을 이미 있는 잠금으로 푼다.
 * ADMIN_PASSWORD 로 /admin 에 들어올 수 있는 사람만 이 화면을 본다.
 * 그리고 계정이 하나라도 생기면 이 문은 영영 닫힌다.
 */
export default async function LmsSetup({ searchParams }: PageProps<'/lms/setup'>) {
  await requireAdmin();

  const problem = lmsSetupProblem();
  if (problem) redirect('/lms/login');
  if ((await userCount()) > 0) redirect('/lms/login');

  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <div className="field" aria-hidden />

      <h1 className="text-[24px] font-bold leading-[1.35]">첫 관리자 만들기</h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">
        이 계정으로 튜터와 학생 계정을 만들어요. 이 화면은 계정이 하나라도 생기면 닫혀요.
      </p>

      <form action={bootstrapAdmin} className="mt-6 flex flex-col gap-3">
        <input
          name="name"
          placeholder="이름"
          required
          className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
        />
        <input
          name="login_id"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="아이디 (영문 소문자·숫자)"
          required
          className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
        />
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder={`비밀번호 (${LMS.minPasswordLength}자 이상)`}
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
          만들기
        </button>
      </form>

      <Link href="/admin" className="mt-6 text-[13px] font-semibold text-muted underline underline-offset-2">
        관리자 화면으로
      </Link>
    </main>
  );
}
