import { create, type Font } from 'fontkit';
import type { PDFDocument } from 'pdf-lib';

/**
 * pdf-lib 에 꽂을 fontkit.
 *
 * pdf-lib 이 원래 짝으로 쓰는 @pdf-lib/fontkit(fontkit 1 기반)은 한글 폰트를 잘라 넣을 때
 * 글자를 군데군데 빈칸으로 만든다 — '3주차 강대K' 가 '  대  ' 로 찍혔다. 폰트를 통째로
 * 넣으면 멀쩡하지만 굵기 둘에 PDF 가 2MB 가 된다. fontkit 2 는 잘라 넣어도 정확하고
 * 같은 PDF 가 20KB 남짓이다.
 *
 * 다만 pdf-lib 은 fontkit 1 의 `subset.encodeStream()` 을 부르는데 fontkit 2 에는
 * `encode()` 만 있다. 그 한 자리만 흉내 낸다 — 다 만든 바이트를 이벤트 하나로 흘려보낸다.
 */

type PdfLibFontkit = Parameters<PDFDocument['registerFontkit']>[0];
type Handler = (value?: unknown) => void;

function streamOf(produce: () => Uint8Array) {
  const handlers: Record<string, Handler> = {};
  const stream = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
      return stream;
    },
  };
  // pdf-lib 은 on(...) 을 이어 붙인 다음에야 기다린다. 등록이 끝난 뒤에 흘린다.
  queueMicrotask(() => {
    try {
      handlers.data?.(produce());
      handlers.end?.();
    } catch (error) {
      handlers.error?.(error);
    }
  });
  return stream;
}

export function openFont(bytes: Uint8Array): Font {
  return create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export const fontkitForPdfLib: PdfLibFontkit = {
  create(bytes: Uint8Array) {
    const font = openFont(bytes);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      return Object.assign(subset, { encodeStream: () => streamOf(() => subset.encode()) });
    };
    return font as unknown as ReturnType<PdfLibFontkit['create']>;
  },
};
