import type { Metadata } from 'next';

// 운영자용 화면 — 검색엔진에 걸리지 않게 한다
export const metadata: Metadata = {
  title: '관리자',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return children;
}
