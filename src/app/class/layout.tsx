import type { Metadata } from 'next';

const TITLE = '국어 3인 관찰반 · 180분';
const DESCRIPTION =
  '시험 치는 80분을 옆에서 봅니다. 지문별 시간을 재고, 그 기록으로 남은 90분을 이야기하는 3인 팀수업.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // 카카오톡·메일에 링크를 붙였을 때 뜨는 카드. 이미지는 opengraph-image.png 를 자동으로 쓴다.
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: '팀과외팀',
    title: TITLE,
    description: DESCRIPTION,
  },
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
