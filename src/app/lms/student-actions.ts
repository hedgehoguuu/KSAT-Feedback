'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertRole } from '@/lib/lms/auth';
import { cleanConcerns, saveConcerns } from '@/lib/lms/concerns';
import { isEnrolled } from '@/lib/lms/courses';
import { findAttempt, getExam, openAttempt, type AttemptRow, type ExamRow } from '@/lib/lms/exams';
import { signedUrls } from '@/lib/lms/files';
import { ensurePhotoRead, requestPhotoRead, type ReadRequest } from '@/lib/lms/photo-read';
import { addPhoto, movePhoto, removePhoto } from '@/lib/lms/photos';
import { readJpeg } from '@/lib/lms/upload';

/**
 * 학생이 하는 쓰기 전부 — 시험지 사진과 문항별 질문.
 *
 * 모든 함수가 맨 앞에서 확인한다: 학생인가, 이 회차가 자기 반의 것인가, 학생에게 열린
 * 회차인가, 답이 이미 나가서 잠기지 않았는가. 응시 id 를 받지 않고 **회차 id 와 로그인한
 * 사람으로 응시를 찾는다** — 남의 응시 id 를 넣어 부르는 길 자체가 없다.
 *
 * 사진이 바뀌면 사진 읽기(자동 채점)를 부른다. 읽기는 응답을 보낸 뒤 뒤에서 돈다
 * (lib/lms/photo-read.ts). 부르다 실패해도 사진 저장은 성공으로 둔다 — 튜터가 다시 읽을 수 있다.
 */

/** 사진 읽기를 부른다. 실패해도 던지지 않는다. */
async function askRead(attemptId: string, run: () => Promise<ReadRequest | 'FRESH'>): Promise<ReadRequest | 'FRESH' | 'ERROR'> {
  try {
    return await run();
  } catch (error) {
    console.error('[lms] 사진 읽기를 부르지 못했어요', attemptId, error);
    return 'ERROR';
  }
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

type Access = { exam: ExamRow; studentId: string };

/** 이 학생이 이 회차에 올릴 수 있는가. 못 하면 null. */
async function access(examId: string): Promise<Access | null> {
  const me = await assertRole('student');
  const exam = examId ? await getExam(examId) : null;
  if (!exam || exam.status !== 'published') return null;
  if (!(await isEnrolled(exam.course_id, me.id))) return null;
  return { exam, studentId: me.id };
}

/** 쓸 응시. 없으면 만든다. 답이 이미 나갔으면 'LOCKED'. */
async function writable({ exam, studentId }: Access): Promise<AttemptRow | 'LOCKED'> {
  const attempt = await openAttempt(exam.id, studentId);
  return attempt.feedback_ready_at ? 'LOCKED' : attempt;
}

export type PhotoUpload =
  | { ok: true; photo: { id: string; url: string | null }; read: ReadRequest | 'FRESH' | 'ERROR' }
  | { ok: false; reason: string };

export type PhotoChange = { ok: boolean; reason?: string; read?: ReadRequest | 'FRESH' | 'ERROR' };

/** 사진 한 장. 브라우저가 줄여서 한 장씩 보낸다 — 서버 함수 한 번의 상한(6MB) 안에 들게. */
export async function uploadPaperPhoto(formData: FormData): Promise<PhotoUpload> {
  const ok = await access(text(formData, 'exam_id'));
  if (!ok) return { ok: false, reason: 'CLOSED' };

  const image = await readJpeg(formData.get('photo'));
  if (!image.ok) return image;

  const attempt = await writable(ok);
  if (attempt === 'LOCKED') return { ok: false, reason: 'LOCKED' };

  let photo: Awaited<ReturnType<typeof addPhoto>>;
  try {
    photo = await addPhoto(attempt.id, image.bytes);
  } catch (error) {
    // 한 장이 실패했다고 화면 전체를 오류로 바꾸지 않는다. 그 장만 '다시 올리기' 가 뜬다.
    console.error('[lms] 시험지 사진 저장 실패', error);
    return { ok: false, reason: 'FAILED' };
  }
  if (photo === 'TOO_MANY') return { ok: false, reason: 'TOO_MANY' };
  // 올리는 사이 튜터가 답을 보냈다. DB 가 막았고 올린 파일은 지웠다.
  if (photo === 'LOCKED') return { ok: false, reason: 'LOCKED' };

  // 한 장씩 올라오는 동안 매번 읽지 않는다. 조용해진 뒤에 한 번 읽는다 (PHOTO_READ.quietMs).
  const read = await askRead(attempt.id, () => requestPhotoRead(attempt.id, { by: 'student' }));
  const urls = await signedUrls([photo.storage_path]);
  revalidatePath(`/lms/me/exams/${ok.exam.id}`);
  return { ok: true, photo: { id: photo.id, url: urls.get(photo.storage_path) ?? null }, read };
}

export async function removePaperPhoto(formData: FormData): Promise<PhotoChange> {
  const ok = await access(text(formData, 'exam_id'));
  if (!ok) return { ok: false, reason: 'CLOSED' };

  const attempt = await findAttempt(ok.exam.id, ok.studentId);
  if (!attempt) return { ok: false, reason: 'NOT_FOUND' };
  if (attempt.feedback_ready_at) return { ok: false, reason: 'LOCKED' };

  const removed = await removePhoto(attempt.id, text(formData, 'photo_id'));
  if (removed === 'LOCKED') return { ok: false, reason: 'LOCKED' };
  // 지운 사진에서 읽힌 답은 채점에서도 빠져야 한다.
  const read =
    removed === 'OK' ? await askRead(attempt.id, () => requestPhotoRead(attempt.id, { by: 'student' })) : undefined;
  revalidatePath(`/lms/me/exams/${ok.exam.id}`);
  return { ok: true, read };
}

/** 순서만 바꾸는 것이라 다시 읽지 않는다 — 문항 번호는 사진에 적혀 있다. */
export async function movePaperPhoto(formData: FormData): Promise<PhotoChange> {
  const ok = await access(text(formData, 'exam_id'));
  if (!ok) return { ok: false, reason: 'CLOSED' };

  const attempt = await findAttempt(ok.exam.id, ok.studentId);
  if (!attempt) return { ok: false, reason: 'NOT_FOUND' };
  if (attempt.feedback_ready_at) return { ok: false, reason: 'LOCKED' };

  await movePhoto(attempt.id, text(formData, 'photo_id'), text(formData, 'step') === 'up' ? -1 : 1);
  revalidatePath(`/lms/me/exams/${ok.exam.id}`);
  return { ok: true };
}

/**
 * 문항별 질문 저장. `intent=submit` 이면 '제출' 로 표시한다 — 튜터의 할 일 목록에 오른다.
 *
 * 칸 이름에 번호를 붙이지 않고 `topic` · `body` 를 반복한다. FormData.getAll() 이 문서에
 * 놓인 순서를 지키므로, 줄을 중간에 넣거나 지워도 짝이 어긋나지 않는다.
 */
export async function saveMyConcerns(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  const base = `/lms/me/exams/${examId}`;
  const ok = await access(examId);
  if (!ok) redirect('/lms/me');

  const topics = formData.getAll('topic').map((v) => String(v));
  const bodies = formData.getAll('body').map((v) => String(v));
  const { drafts, problem } = cleanConcerns(
    bodies.map((body, i) => ({ question_no: topics[i] === '' ? Number.NaN : Number(topics[i]), body })),
  );
  if (problem) redirect(`${base}?error=${problem === 'LONG' ? 'long' : 'topic'}`);

  const submit = text(formData, 'intent') === 'submit';
  if (submit && drafts.length === 0) redirect(`${base}?error=empty`);

  const attempt = await writable(ok);
  if (attempt === 'LOCKED') redirect(`${base}?error=locked`);
  if ((await saveConcerns(attempt.id, drafts, submit)) === 'LOCKED') redirect(`${base}?error=locked`);

  // 사진을 올릴 때 부른 읽기가 상한에 걸렸거나 중간에 끊겼으면 여기서 한 번 더 부른다.
  if (submit) await askRead(attempt.id, () => ensurePhotoRead(attempt.id));

  revalidatePath(base);
  revalidatePath('/lms/me');
  redirect(`${base}?${submit ? 'submitted' : 'saved'}=1`);
}
