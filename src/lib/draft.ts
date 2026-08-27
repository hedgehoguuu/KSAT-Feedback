'use client';

import { uid } from './id';

const KEY = 'ksat-feedback:draftId';

/** 제출 전 이미지를 모아 둘 초안 id. 접수번호는 제출(BE-2) 때 붙는다. */
export function getDraftId(): string {
  try {
    const found = localStorage.getItem(KEY);
    if (found) return found;
    const next = uid();
    localStorage.setItem(KEY, next);
    return next;
  } catch {
    return uid();
  }
}

export function clearDraftId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 사파리 프라이빗 모드 등 — 초안 id 를 못 지워도 접수에는 지장이 없다
  }
}
