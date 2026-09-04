import type { ReactNode } from 'react';
import Link from 'next/link';
import { logout } from '@/app/admin/actions';
import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: '클래스' },
  { href: '/admin/applications', label: '신청자' },
  { href: '/setup', label: '설치 점검' },
];

export default async function GuardedAdminLayout({ children }: { children: ReactNode }) {
  // 이 아래 화면은 전부 이 한 줄이 지킨다. 쓰기(서버 함수)는 따로 또 확인한다.
  await requireAdmin();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <nav className="flex gap-3">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-[14px] font-bold text-muted hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logout}>
          <button type="submit" className="text-[13px] font-semibold text-muted underline underline-offset-2">
            나가기
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
