import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '국어 3인 관찰반 · 180분',
  description:
    '시험지에는 결과만 남습니다. 우리는 그 80분을 봅니다 — 튜터가 옆에서 지문별 시간을 재고, 그 기록으로 90분을 이야기하는 3인 팀수업.',
};

export default function ClassLayout({ children }: LayoutProps<'/class'>) {
  return (
    <>
      {/* 자바스크립트가 살아 있을 때만 스크롤 등장 효과를 켠다.
          화면보다 먼저 실행돼야 글이 깜빡이지 않는다. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      {children}
    </>
  );
}
