import 'server-only';
import { LMS } from '@/config/lms';
import { db, must, one, rows } from './db';
import { paths, putFile, removeFiles, removeFilesQuietly } from './files';

/**
 * 학생이 올린 시험지 사진 (lms_attempt_photos). 응시 하나에 여러 장.
 *
 * 사진 줄이 생기거나 지워지는 순간 DB 가 사진으로 매긴 채점을 비운다 (0016 트리거).
 * 새 사진까지 읽은 결과로 다시 채우는 것은 사진 읽기(photo-read.ts)의 몫이다.
 * 순서만 바꾸는 것은 사진 묶음이 그대로라 채점을 건드리지 않는다.
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
 *
 * 줄이 생기는 순간 DB 가 사진으로 매긴 채점을 비운다 (0016 트리거). 새 사진까지 읽은 결과로
 * 다시 채우는 것은 사진 읽기(photo-read.ts)의 몫이다.
 */
export async function addPhoto(attemptId: string, bytes: Uint8Array): Promise<PhotoRow | 'TOO_MANY'> {
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
    if (error || !data) throw error ?? new Error('LMS_PHOTO_INSERT_FAILED');
    return data as unknown as PhotoRow;
  } catch (error) {
    await removeFilesQuietly([path]);
    throw error;
  }
}

/**
 * 사진을 지운다. 이 응시의 사진이 아니면 아무것도 안 한다. 파일을 먼저 지운다.
 * 줄이 지워지는 순간 DB 가 사진으로 매긴 채점을 비운다 (0016 트리거).
 */
export async function removePhoto(attemptId: string, photoId: string): Promise<boolean> {
  const photo = await one<PhotoRow>(
    db().from('lms_attempt_photos').select(PHOTO_COLS).eq('id', photoId).eq('attempt_id', attemptId).maybeSingle(),
  );
  if (!photo) return false;

  await removeFiles([photo.storage_path]);
  await must(db().from('lms_attempt_photos').delete().eq('id', photo.id));
  return true;
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
