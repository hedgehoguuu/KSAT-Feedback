'use client';

/**
 * 리사이즈한 이미지 원본. 실패한 장만 다시 올리기(FE-4) 위해 브라우저 메모리에 들고 있는다.
 * localStorage 에는 넣지 않는다 — 새로고침하면 사라지고, 그때는 다시 고르게 안내한다.
 */
const blobs = new Map<string, Blob>();

export function keepBlob(id: string, blob: Blob) {
  blobs.set(id, blob);
}

export function takeBlob(id: string): Blob | undefined {
  return blobs.get(id);
}

export function dropBlob(id: string) {
  blobs.delete(id);
}
