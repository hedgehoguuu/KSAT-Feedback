// 클라이언트 이미지 정규화 (BE-1)
// 긴 변 2000px, JPEG q0.82. HEIC 문제와 용량 문제를 동시에 해결한다.

import { LIMITS } from '@/config/app';

export type NormalizedImage = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  previewUrl: string;
};

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // EXIF 회전을 반영해서 디코드한다 (세로로 찍은 사진이 눕지 않게)
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari 구버전 등 옵션 미지원 → 아래 폴백
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // decode() 이후에도 img 는 픽셀을 들고 있다
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

export async function normalizeImage(file: File): Promise<NormalizedImage> {
  const src = await decode(file);
  const { w, h } = sizeOf(src);
  const scale = Math.min(1, LIMITS.resizeLongEdge / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(src as CanvasImageSource, 0, 0, width, height);
  if ('close' in src) src.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', LIMITS.jpegQuality),
  );
  if (!blob) throw new Error('이미지를 변환하지 못했어요');

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { blob, name, width, height, previewUrl: URL.createObjectURL(blob) };
}
