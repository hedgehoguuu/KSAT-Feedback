import type { ReactNode } from 'react';
import Link from 'next/link';
import { ROLES, type Role } from '@/config/lms';
import { logout } from '@/app/lms/actions';

/** 역할마다 다른 메뉴. 없는 화면은 아예 안 보여준다 — 눌렀다 튕기는 것보다 낫다. */
const NAV: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: '/lms/admin', label: '계정' },
    { href: '/lms/admin/courses', label: '반' },
  ],
  tutor: [{ href: '/lms/tutor', label: '내 반' }],
  student: [{ href: '/lms/me', label: '내 성적' }],
};

export function Shell({
  user,
  children,
}: {
  user: { name: string; role: Role };
  children: ReactNode;
}) {
  return (
    // .lms-page 가 켜져 있는 동안만 본문 기둥이 1080px 로 넓어진다 (globals.css).
    <div className="lms-page flex flex-1 flex-col">
      <header className="glass-bar sticky top-0 z-10 border-b border-line">
        <div className="flex w-full items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-4">
            <Link href="/lms" className="text-[15px] font-extrabold">
              성적 관리
            </Link>
            <nav className="flex gap-3">
              {NAV[user.role].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-[14px] font-bold text-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-muted sm:inline">
              {user.name} · {ROLES[user.role]}
            </span>
            <Link href="/lms/password" className="text-[13px] font-semibold text-muted hover:text-foreground">
              비밀번호
            </Link>
            <form action={logout}>
              <button type="submit" className="text-[13px] font-semibold text-muted underline underline-offset-2">
                나가기
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="w-full flex-1 px-5 py-6">{children}</main>
    </div>
  );
}

/* ────────────────────────────────────────────────────── 되풀이되는 조각 */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-solid rounded-2xl p-5 ${className}`}>
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-[15px] font-extrabold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * 지표 한 칸. 숫자는 크게, 딱지는 작게. 큰 숫자에는 tabular-nums 를 걸지 않는다 —
 * 자릿수를 맞춰 벌리면 '121' 같은 수가 헐거워 보인다. 표 안에서만 걸어야 하는 설정이다.
 */
export function Stat({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="glass-inset rounded-xl px-4 py-3">
      <p className="text-[12px] font-bold text-muted">{label}</p>
      <p className="mt-1 text-[22px] font-extrabold leading-none">
        {value}
        {unit ? <span className="ml-0.5 text-[13px] font-bold text-muted">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1 text-[12px] text-muted">{note}</p> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[14px] leading-[1.6] text-muted">{children}</p>;
}

/* 버튼·입력칸 — 접수 흐름에서 쓰던 것과 같은 모양이되 표 화면이라 한 치수 작다. */
export const btn =
  'inline-flex min-h-10 items-center justify-center rounded-xl bg-brand px-4 text-[14px] font-bold text-white active:bg-brand-pressed';
export const btnGhost =
  'inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white/60 px-4 text-[14px] font-bold text-foreground active:bg-surface';
export const btnDanger =
  'inline-flex min-h-10 items-center justify-center rounded-xl border border-line px-4 text-[14px] font-bold text-danger active:bg-surface';
export const input =
  'min-h-10 w-full rounded-xl border border-line bg-white/70 px-3 text-[14px] outline-none focus:border-brand';
export const label = 'mb-1 block text-[12px] font-bold text-muted';
