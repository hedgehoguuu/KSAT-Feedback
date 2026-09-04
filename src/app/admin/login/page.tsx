import { login } from '@/app/admin/actions';
import { adminConfigured, isAdmin } from '@/lib/admin';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLogin({ searchParams }: PageProps<'/admin/login'>) {
  if (await isAdmin()) redirect('/admin');
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-[24px] font-bold leading-[1.35]">관리자</h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-muted">
        개설 클래스와 신청자를 보는 화면이에요.
      </p>

      {!adminConfigured() ? (
        <div className="mt-6 rounded-2xl bg-surface p-4">
          <p className="text-[15px] font-bold">아직 잠금이 설정되지 않았어요</p>
          <p className="mt-1 text-[13px] leading-[1.6] text-muted">
            Vercel → Settings → Environment Variables 에 <span className="font-bold">ADMIN_PASSWORD</span> 를
            넣고 다시 배포하면 열려요.
          </p>
        </div>
      ) : (
        <form action={login} className="mt-6 flex flex-col gap-3">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="비밀번호"
            required
            className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
          />
          {error ? (
            <p className="text-[13px] text-danger" role="alert">
              비밀번호가 달라요
            </p>
          ) : null}
          <button
            type="submit"
            className="min-h-13 rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
          >
            들어가기
          </button>
        </form>
      )}
    </main>
  );
}
