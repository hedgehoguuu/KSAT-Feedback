import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Analytics } from '@/components/Analytics';
import { BRANDING } from '@/config/app';

export const metadata: Metadata = {
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
        <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  );
}
