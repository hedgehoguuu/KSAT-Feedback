import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LMS } from '@/config/lms';
import { adminConfigured, isAdmin } from '@/lib/admin';
import { lmsSetupProblem } from '@/lib/lms/auth';
import { tryUserCount } from '@/lib/lms/users';
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
  const problem = lmsSetupProblem();
  if (problem) redirect('/lms/login');

  // 0명일 때만 연다. 못 물어봤으면(null) 열지 않는다 — 이미 계정이 있는 DB 에
  // 관리자를 하나 더 만들어 주는 쪽이 훨씬 나쁘다. 로그인 화면이 왜 안 되는지 말해 준다.
  const count = await tryUserCount();
  if (count !== 0) redirect('/lms/login');

  /**
   * 관리자가 아니면 로그인 화면으로 조용히 넘기지 않고 왜 못 들어오는지 말해 준다.
   *
   * 넘겨 버리면 프리뷰 배포에서 반드시 막힌다 — 프로덕션 주소에서 /admin 에 로그인해도
   * 그 쿠키는 그 도메인에만 붙으므로, 다른 주소인 프리뷰의 이 화면에서는 로그인한 적이
   * 없는 사람이다. 그런데 화면은 아무 말 없이 로그인 화면으로 튕기고, 거기서 로그인하면
   * /admin 으로 갈 뿐 여기로 돌아오지 않는다. 제자리를 맴돌게 된다.
   */
  if (!(await isAdmin())) return <NeedsAdminLock />;

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

function NeedsAdminLock() {
  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <div className="field" aria-hidden />

      <h1 className="text-[24px] font-bold leading-[1.35]">먼저 관리자로 들어와 주세요</h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">
        첫 관리자 계정은 아직 계정이 하나도 없을 때만 만들 수 있어요. 그래서 이 화면은
        기존 관리자 잠금(<span className="font-bold">ADMIN_PASSWORD</span>)이 지켜요.
      </p>

      <div className="glass-solid mt-6 rounded-2xl p-4">
        <p className="text-[15px] font-bold">지금 보고 있는 주소에서 로그인해야 해요</p>
        <p className="mt-1 text-[13px] leading-[1.6] text-muted">
          프리뷰 배포와 실제 주소는 서로 다른 도메인이라 로그인이 따라오지 않아요.
          한쪽에서 로그인했더라도 <span className="font-bold">이 주소의</span> /admin 에서 다시
          한 번 들어와 주세요.
        </p>
      </div>

      {!adminConfigured() ? (
        <p className="mt-4 text-[13px] leading-[1.6] text-muted">
          이 배포에는 <span className="font-bold">ADMIN_PASSWORD</span> 가 아직 없어요.
          Vercel → Settings → Environment Variables 에 넣고 다시 배포해주세요.
        </p>
      ) : null}

      <Link
        href="/admin/login"
        className="mt-6 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
      >
        관리자로 로그인하기
      </Link>
      <p className="mt-3 text-[13px] leading-[1.6] text-muted">
        들어간 뒤 위쪽 <span className="font-bold">성적 관리</span> 메뉴를 누르면 여기로 돌아와요.
      </p>
    </main>
  );
}
