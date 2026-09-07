import type { Metadata } from 'next';

// 수업 운영 화면 — 검색엔진에 걸리지 않게 한다. 학생 이름과 성적이 올라가는 곳이다.
export const metadata: Metadata = {
  title: '성적 관리',
  robots: { index: false, follow: false },
};

export default function LmsLayout({ children }: LayoutProps<'/lms'>) {
  return children;
}
