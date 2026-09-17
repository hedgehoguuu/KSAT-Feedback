import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/lms/auth';
import { isEnrolled } from '@/lib/lms/courses';
import { findAttempt, getExam } from '@/lib/lms/exams';
import { listPhotos } from '@/lib/lms/feedback';
import { getPhotoRead } from '@/lib/lms/photo-read';
import { readViewOf } from '@/lib/lms/photo-read-state';

export const dynamic = 'force-dynamic';

/**
 * 학생 화면이 사진 읽기가 끝났는지 묻는 곳. 읽은 답은 주지 않는다 — 학생에게 필요한 것은
 * '다시 찍을 사진이 있는가' 뿐이고, 그건 화면을 새로 그릴 때 함께 온다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== 'student') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { examId } = await params;
  const exam = await getExam(examId);
  if (!exam || exam.status !== 'published' || !(await isEnrolled(exam.course_id, user.id))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const attempt = await findAttempt(exam.id, user.id);
  if (!attempt) return NextResponse.json({ kind: 'none', request: 0 }, { headers: { 'Cache-Control': 'private, no-store' } });

  const [read, photos] = await Promise.all([getPhotoRead(attempt.id), listPhotos(attempt.id)]);
  const view = readViewOf(read, photos.map((p) => p.id));
  return NextResponse.json(
    { kind: view.kind, request: read?.request_no ?? 0 },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
