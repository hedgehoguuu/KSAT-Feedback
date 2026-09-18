import type { ReactNode } from 'react';
import Link from 'next/link';
import { logout } from '@/app/admin/actions';
import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: '클래스' },
  { href: '/admin/applications', label: '신청자' },
  // 성적 관리(/lms)는 계정이 따로다. 여기서 눌러 들어가면 같은 도메인이라
  // 첫 관리자를 만들 때 이 화면의 잠금이 그대로 열쇠가 된다.
  { href: '/lms', label: '성적 관리' },
  { href: '/setup', label: '설치 점검' },
];

export default async function GuardedAdminLayout({ children }: { children: ReactNode }) {
  // 첫 번째 문. 레이아웃은 화면 사이를 옮겨 다닐 때 다시 돌지 않아서(Partial Rendering) 이것만 믿지
  // 않는다 — 화면마다 requireAdmin() 을 또 부르고, 쓰기(서버 함수)는 assertAdmin() 으로 따로 본다.
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
