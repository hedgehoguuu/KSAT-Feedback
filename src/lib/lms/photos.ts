import 'server-only';
import { LMS } from '@/config/lms';
import { db, must, one, rows } from './db';
import { paths, putFile, removeFilesQuietly } from './files';

/**
 * 학생이 올린 시험지 사진 (lms_attempt_photos). 응시 하나에 여러 장.
 *
 * 질문에 답할 때 선생님이 보는 자료다. 채점과는 상관이 없다 — 채점은 선생님이 OMR 로 한다 (0020).
 * 답을 보낸 시험의 사진은 DB 트리거가 넣지도 지우지도 못하게 막는다 (0018 · 0020).
 */

export type PhotoRow = {
  id: string;
  attempt_id: string;
  storage_path: string;
  order_index: number;
  bytes: number | null;
  created_at: string;
};

const PHOTO_COLS = 'id, attempt_id, storage_path, order_index, bytes, created_at';

export async function listPhotos(attemptId: string): Promise<PhotoRow[]> {
  return await rows<PhotoRow>(
    db()
      .from('lms_attempt_photos')
      .select(PHOTO_COLS)
      .eq('attempt_id', attemptId)
      .order('order_index')
      .order('created_at'),
  );
}

/**
 * 사진 한 장을 올린다. 파일을 먼저 올리고 줄을 만든다 — 줄을 못 만들면 파일을 도로 지운다.
 * 그러지 않으면 어디에도 안 보이는 시험지 사진이 저장소에 남는다.
 */
export async function addPhoto(attemptId: string, bytes: Uint8Array): Promise<PhotoRow | 'TOO_MANY' | 'LOCKED'> {
  const existing = await listPhotos(attemptId);
  if (existing.length >= LMS.maxPhotos) return 'TOO_MANY';

  const path = paths.photo(attemptId);
  await putFile(path, bytes, 'image/jpeg');
  try {
    const next = existing.reduce((max, p) => Math.max(max, p.order_index), -1) + 1;
    const { data, error } = await db()
      .from('lms_attempt_photos')
      .insert({ attempt_id: attemptId, storage_path: path, order_index: next, bytes: bytes.byteLength })
      .select(PHOTO_COLS)
      .single();
    // 올리는 사이 튜터가 답을 보냈다 — DB(사진 트리거)가 막았다. 올린 파일은 아래에서 지운다.
    if (error?.code === 'P0001' && error.message === 'LOCKED') {
      await removeFilesQuietly([path]);
      return 'LOCKED';
    }
    if (error || !data) throw error ?? new Error('LMS_PHOTO_INSERT_FAILED');
    return data as unknown as PhotoRow;
  } catch (error) {
    await removeFilesQuietly([path]);
    throw error;
  }
}

/**
 * 사진을 지운다. 이 응시의 사진이 아니면 'NOT_FOUND'.
 *
 * 한 장을 지울 때는 줄을 먼저 지운다. 답을 보낸 시험이면 DB 가 줄 지우기를 막는데(사진
 * 트리거), 파일부터 지우면 거절돼도 사진은 이미 사라진다 — 보낸 PDF 와 튜터 화면의 사진이 깨진다.
 * 그 뒤 파일 지우기가 실패하면 저장소에 한 장이 남고 로그에 적힌다.
 * (회차 · 반 · 계정을 통째로 지울 때는 파일을 먼저 지운다 — files.ts)
 */
export async function removePhoto(attemptId: string, photoId: string): Promise<'OK' | 'NOT_FOUND' | 'LOCKED'> {
  const photo = await one<PhotoRow>(
    db().from('lms_attempt_photos').select(PHOTO_COLS).eq('id', photoId).eq('attempt_id', attemptId).maybeSingle(),
  );
  if (!photo) return 'NOT_FOUND';

  const { error } = await db().from('lms_attempt_photos').delete().eq('id', photo.id);
  if (error?.code === 'P0001' && error.message === 'LOCKED') return 'LOCKED';
  if (error) throw error;

  await removeFilesQuietly([photo.storage_path]);
  return 'OK';
}

/** 한 칸 앞뒤로. 번호가 겹쳐 있을 수 있어서 옮긴 김에 0 부터 다시 매긴다. */
export async function movePhoto(attemptId: string, photoId: string, step: -1 | 1): Promise<void> {
  const list = await listPhotos(attemptId);
  const from = list.findIndex((p) => p.id === photoId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;

  [list[from], list[to]] = [list[to], list[from]];
  for (const [index, photo] of list.entries()) {
    if (photo.order_index !== index) {
      await must(db().from('lms_attempt_photos').update({ order_index: index }).eq('id', photo.id));
    }
  }
}
