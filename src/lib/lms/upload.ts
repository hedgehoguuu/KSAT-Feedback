import 'server-only';
import { LMS } from '@/config/lms';

/**
 * 서버 함수로 받은 사진 한 장을 확인한다.
 *
 * 브라우저가 긴 변 2000px JPEG 로 줄여서 보낸다 (lib/image.ts). 그래도 여기서 다시 본다 —
 * 서버 함수는 화면을 거치지 않고 불릴 수 있고, 저장소에 들어간 파일은 나중에 PDF 에 박힌다.
 * 확장자나 파일 형식 표시가 아니라 **파일 첫 바이트**를 본다. 둘 다 보내는 쪽이 정한다.
 */
export type ImageCheck = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'NO_FILE' | 'TOO_BIG' | 'NOT_JPEG' };

export async function readJpeg(value: FormDataEntryValue | null): Promise<ImageCheck> {
  if (!(value instanceof File) || value.size === 0) return { ok: false, reason: 'NO_FILE' };
  if (value.size > LMS.maxPhotoBytes) return { ok: false, reason: 'TOO_BIG' };

  const bytes = new Uint8Array(await value.arrayBuffer());
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return jpeg ? { ok: true, bytes } : { ok: false, reason: 'NOT_JPEG' };
}
