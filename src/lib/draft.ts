'use client';

import { uid } from './id';

const KEY = 'ksat-feedback:draftId';

/**
 * 저장소를 못 쓸 때 대신 들고 있는 값.
 *
 * 사파리 프라이빗 모드나 '쿠키·사이트 데이터 차단' 을 켠 브라우저에서는 localStorage
 * 접근 자체가 예외를 던진다. 예전에는 그때마다 새 id 를 만들어 돌려줬는데, 이 함수는
 * 사진을 올릴 때마다·제출할 때 다시 불린다 — 즉 사진마다 다른 폴더에 올라가고, 제출할
 * 때는 또 다른 id 가 붙어서 서버가 "이 접수의 사진이 아니다" 로 전부 거절했다.
 * 접수 자체가 통째로 안 되는 상태였다. 그래서 한 번 만든 값을 메모리에 붙잡아 둔다.
 */
let fallback: string | null = null;

/** 제출 전 이미지를 모아 둘 초안 id. 접수번호는 제출(BE-2) 때 붙는다. */
export function getDraftId(): string {
  try {
    const found = localStorage.getItem(KEY);
    if (found) return found;
    const next = fallback ?? uid();
    fallback = next;
    localStorage.setItem(KEY, next);
    return next;
  } catch {
    // 저장은 못 해도 이 세션 동안은 같은 값을 쓴다
    fallback ??= uid();
    return fallback;
  }
}

export function clearDraftId(): void {
  fallback = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 써도 위에서 메모리 값을 비웠으므로 다음 접수는 새 id 로 시작한다
  }
}
