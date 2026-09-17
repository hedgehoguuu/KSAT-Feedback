import 'server-only';
import { NextResponse } from 'next/server';

/**
 * PDF 를 내려보내는 응답. 튜터 미리 보기와 학생 받기가 같이 쓴다.
 *
 * 파일 이름에 한글이 들어가므로 RFC 5987 형식(filename*)으로도 준다. 옛 브라우저를 위한
 * filename 에는 영문만 넣는다 — 거기에 한글을 넣으면 글자가 깨진 이름으로 저장된다.
 */
export function pdfResponse(bytes: Uint8Array, name: string, disposition: 'inline' | 'attachment'): NextResponse {
  const body = new Blob([bytes.slice()], { type: 'application/pdf' });
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="feedback.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 학생 이름과 시험지가 든 파일이다. 어디에도 남기지 않는다.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
