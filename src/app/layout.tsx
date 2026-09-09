import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Analytics } from '@/components/Analytics';
import { BRANDING } from '@/config/app';
import { siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  /**
   * 링크 미리보기(카카오톡·메일)가 이미지 주소를 절대 주소로 읽어야 해서 기준을 잡아 준다.
   * Vercel 이 넣어 주는 값이라 로컬에서는 없다.
   */
  metadataBase: siteUrl() ? new URL(siteUrl() as string) : undefined,
  title: `9월 모의고사 ${BRANDING.serviceName}`,
  description: '시험지 사진만 보내주면, 어디서 시간이 샜는지 직접 보고 알려드려요.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 폰에서 입력창을 눌러도 화면이 확대되지 않게 하되, 확대 자체는 막지 않는다
  maximumScale: 5,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface">
        {/*
          스크롤 등장 효과(Reveal)를 끄는 안전장치.

          예전에는 React 보다 먼저 도는 스크립트가 <html> 에 `js` 를 붙이고, CSS 가
          `html.js` 아래에서만 숨겼다. 그러면 서버가 그린 class 와 하이드레이션 시점의
          class 가 달라서 모든 방문자의 콘솔에 하이드레이션 불일치 오류가 찍혔다 —
          고칠 수 없는 가짜 오류가 진짜 오류를 덮는다(suppressHydrationWarning 으로도
          안 잡힌다).

          그래서 DOM 을 건드리지 않는 쪽으로 뒤집었다. 숨기는 규칙은 CSS 에 그냥 두고,
          자바스크립트가 꺼져 있을 때만 이 안의 규칙이 살아나 도로 보이게 한다.
          브라우저가 알아서 하는 일이라 서버와 클라이언트가 어긋날 자리가 없다.

          /class 가 아니라 여기 두는 이유는, 지금은 Reveal 을 /class 만 쓰지만 나중에
          다른 화면에서 쓰는 순간 안전장치만 빠지기 때문이다. 규칙이 CSS 전역에 있으면
          그것을 푸는 것도 전역에 있어야 한다.
        */}
        <noscript>
          <style>{'.reveal { opacity: 1 !important; transform: none !important; }'}</style>
        </noscript>

        {/* 유리 뒤에 비칠 색. 화면에 고정돼 있어서 내용만 그 위를 지나간다 (globals.css) */}
        <div className="field" aria-hidden />
        <div className="shell mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  );
}
