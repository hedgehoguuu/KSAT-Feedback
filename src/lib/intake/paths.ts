// 제출 전 시험지 사진이 저장소에 놓이는 자리. 서명 주소를 내주는 쪽(api/upload-url)과 제출을 받는
// 쪽(api/submit)이 같은 모양을 봐야 한다 — 한쪽만 바꾸면 사진은 올라가는데 제출이 전부 거절된다.

/** 초안 id · 사진 id · 멱등키의 모양. 브라우저가 만든 uuid 다 (lib/id.ts). */
export function isIdShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/**
 * 제출 전이라 접수번호가 아직 없다. 초안 id 로 쌓아두고 제출(BE-2) 때 접수번호와 묶는다.
 *
 * 경로에 순번을 쓰면 안 된다. 사진을 지웠다가 다시 올릴 때 같은 순번이 다시 나와
 * 먼저 올린 파일을 덮어쓴다. 사진마다 고유한 id 를 쓰고, 순서는 제출할 때 따로 보낸다.
 */
export function draftPhotoPath(draftId: string, subject: string, fileId: string): string {
  return `raw/drafts/${draftId}/${subject}/${fileId}.jpg`;
}

const DRAFT_PHOTO = /^raw\/drafts\/([A-Za-z0-9-]{8,64})\/([a-z_]{3,12})\/[A-Za-z0-9-]{8,64}\.jpg$/;

/** draftPhotoPath() 가 만든 경로를 푼다. 모양이 틀리면 null. */
export function parseDraftPhotoPath(path: string): { draftId: string; subject: string } | null {
  const m = DRAFT_PHOTO.exec(path);
  return m ? { draftId: m[1], subject: m[2] } : null;
}
