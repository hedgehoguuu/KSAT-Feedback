import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 관리자 화면의 증빙 이미지 업로드. 버킷 상한(5MB)에 multipart 여유를 더한 값이다.
      bodySizeLimit: '6mb',
    },
  },
};

export default nextConfig;
