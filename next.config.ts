import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 관리자 화면의 증빙 이미지 · LMS 시험지 사진 업로드. 사진은 브라우저가 줄여서 한 장씩
      // 보내고(5MB 상한, config/lms.ts), 여기에 multipart 여유를 더한 값이다.
      bodySizeLimit: '6mb',
    },
  },
  // 답변 PDF 에 넣는 한글 폰트(lib/lms/pdf/fonts.ts). 파일을 경로로 읽어서 추적기가 못 볼 수
  // 있으니 LMS 화면의 서버 함수 묶음에 반드시 따라가게 적어 둔다.
  outputFileTracingIncludes: {
    '/lms/**': ['./assets/fonts/**'],
  },
};

export default nextConfig;
