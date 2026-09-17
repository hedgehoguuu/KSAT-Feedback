import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FontFiles } from './feedback-pdf';

/**
 * PDF 에 넣을 한글 폰트. 사이트와 같은 Pretendard 다 (assets/fonts, SIL OFL 1.1).
 *
 * 저장소에 파일로 둔다. 배포할 때마다 CDN 에서 받아 오면 그쪽이 흔들리는 날 답변 PDF 가
 * 통째로 안 나간다. 서버 함수 묶음에 이 파일들이 따라가도록 next.config.ts 의
 * outputFileTracingIncludes 에 경로를 적어 뒀다 — 폴더를 옮기면 거기도 같이 고친다.
 *
 * 파일을 고치지 않는다. OFL 은 이름(Pretendard)을 그대로 쓴 채 글자를 덜어 낸 파일을
 * 배포하는 것을 막는다. PDF 에 넣을 때 쓰인 글자만 잘라 넣는 것은 괜찮다.
 */
const DIR = path.join(process.cwd(), 'assets', 'fonts');

let cached: Promise<FontFiles> | null = null;

export function loadFonts(): Promise<FontFiles> {
  cached ??= Promise.all([
    readFile(path.join(DIR, 'Pretendard-Regular.ttf')),
    readFile(path.join(DIR, 'Pretendard-Bold.ttf')),
  ])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error) => {
      // 실패를 붙잡아 두면 다음 요청도 영영 실패한다. 다시 읽게 비운다.
      cached = null;
      throw error;
    });
  return cached;
}
