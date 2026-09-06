import type { Metadata } from 'next';

// 주소에 접수번호가 들어가는 개인 화면 — 검색엔진에 걸리지 않게 한다
export const metadata: Metadata = {
  title: '접수 완료',
  robots: { index: false, follow: false },
};

export default function DoneLayout({ children }: LayoutProps<'/done'>) {
  return children;
}
