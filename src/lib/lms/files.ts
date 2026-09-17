import 'server-only';
import { randomUUID } from 'node:crypto';
import { db, inChunks } from './db';

/**
 * LMS 파일 — 학생 시험지 사진 · 튜터 풀이 사진 · 답변 PDF.
 *
 * 비공개 버킷 lms-files 에 둔다 (0015). 접수 흐름의 exam-papers 와 섞지 않는다 — 저건
 * 30일 뒤 지우고 주인 없는 사진을 매일 치우는 버킷이라, 수업 중인 사진이 거기 있으면
 * 크론이 지워 버린다.
 *
 * 경로는 응시 단위로 묶는다: attempts/{응시}/paper/… · answers/… · feedback-….pdf
 * 파일 이름에는 매번 새 id 를 쓴다. 같은 이름을 다시 쓰면 지웠다 다시 올릴 때
 * 브라우저가 옛 사진을 보여 주고, 실패한 저장이 멀쩡한 파일을 덮어쓴다.
 *
 * DB 는 줄이 지워질 때 파일까지 지워 주지 않는다. 그래서 지울 때는 **파일을 먼저** 지운다.
 * 반대로 하면 파일 삭제가 실패했을 때 학생 시험지 사진이 주인 없이 남는다 — 이름과
 * 필기가 찍힌 사진이다.
 */

export const LMS_BUCKET = 'lms-files';

/** 화면에 띄우는 주소의 수명(초). 공개 주소가 아니라 한 번 새도 곧 닫힌다. */
const URL_TTL = 60 * 60;

export const paths = {
  photo: (attemptId: string) => `attempts/${attemptId}/paper/${randomUUID()}.jpg`,
  answerImage: (attemptId: string, concernId: string) =>
    `attempts/${attemptId}/answers/${concernId}-${randomUUID()}.jpg`,
  feedback: (attemptId: string) => `attempts/${attemptId}/feedback-${Date.now()}.pdf`,
};

function bucket() {
  return db().storage.from(LMS_BUCKET);
}

export async function putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

export async function getFile(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw error ?? new Error('LMS_FILE_MISSING');
  return new Uint8Array(await data.arrayBuffer());
}

/** 지운다. 실패하면 던진다 — 부른 쪽이 줄을 지우지 않고 멈춰야 한다. */
export async function removeFiles(list: (string | null | undefined)[]): Promise<void> {
  const targets = [...new Set(list.filter((p): p is string => Boolean(p)))];
  // 한 번에 1,000개까지 받는다. 넉넉히 나눈다.
  for (let i = 0; i < targets.length; i += 500) {
    const { error } = await bucket().remove(targets.slice(i, i + 500));
    if (error) throw error;
  }
}

/** 지우기를 시도만 한다. 이미 새 파일로 바뀐 옛 파일처럼, 남아도 화면이 틀리지 않는 것에만 쓴다. */
export async function removeFilesQuietly(list: (string | null | undefined)[]): Promise<void> {
  try {
    await removeFiles(list);
  } catch (error) {
    console.error('[lms] 파일을 못 지웠어요', list, error);
  }
}

/**
 * 볼 때마다 새로 만드는 임시 주소. 못 만들면 빈 자리로 둔다 — 사진 한 장 때문에
 * 채점 화면이 통째로 막히면 안 된다. 화면은 '사진을 못 불러왔어요' 라고 말한다.
 */
export async function signedUrls(list: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (list.length === 0) return urls;

  const { data, error } = await bucket().createSignedUrls(list, URL_TTL);
  if (error || !data) {
    console.error('[lms] 사진 주소를 못 만들었어요', error);
    return urls;
  }
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** 이 응시들에 딸린 파일 전부. 줄을 지우기 전에 부른다. */
export async function filesOfAttempts(attemptIds: string[]): Promise<string[]> {
  if (attemptIds.length === 0) return [];

  const [photos, images, pdfs] = await Promise.all([
    inChunks<{ storage_path: string }>(attemptIds, (b) =>
      db().from('lms_attempt_photos').select('storage_path').in('attempt_id', b).order('id')),
    inChunks<{ answer_image_path: string | null }>(attemptIds, (b) =>
      db()
        .from('lms_concerns')
        .select('answer_image_path')
        .in('attempt_id', b)
        .not('answer_image_path', 'is', null)
        .order('id')),
    inChunks<{ feedback_path: string | null }>(attemptIds, (b) =>
      db().from('lms_attempts').select('feedback_path').in('id', b).not('feedback_path', 'is', null).order('id')),
  ]);

  return [
    ...photos.map((p) => p.storage_path),
    ...images.map((c) => c.answer_image_path ?? ''),
    ...pdfs.map((a) => a.feedback_path ?? ''),
  ].filter(Boolean);
}

/** 회차들 아래 모든 응시의 파일을 지운다. 회차 · 반을 지우기 직전에 부른다. */
export async function removeFilesOfExams(examIds: string[]): Promise<void> {
  if (examIds.length === 0) return;
  const attempts = await inChunks<{ id: string }>(examIds, (b) =>
    db().from('lms_attempts').select('id').in('exam_id', b).order('id'));
  await removeFiles(await filesOfAttempts(attempts.map((a) => a.id)));
}
