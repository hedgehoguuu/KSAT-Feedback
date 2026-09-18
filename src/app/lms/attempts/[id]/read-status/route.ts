import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { getAttempt, getExam } from '@/lib/lms/exams';
import { getPhotoRead } from '@/lib/lms/photo-read';
import { readViewOf } from '@/lib/lms/photo-read-state';
import { listPhotos } from '@/lib/lms/photos';

export const dynamic = 'force-dynamic';

/**
 * 채점 화면이 사진 읽기가 끝났는지 묻는 곳. 화면 전체를 몇 초마다 새로 그리면 사진 주소가
 * 매번 바뀌어 사진을 다시 받는다. 여기서는 상태만 주고, 바뀌었을 때 화면이 한 번 새로 그린다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== 'tutor' && user.role !== 'admin')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const attempt = await getAttempt(id);
  const exam = attempt ? await getExam(attempt.exam_id) : null;
  if (!attempt || !exam || !(await courseVisibleTo(exam.course_id, user))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const [read, photos] = await Promise.all([getPhotoRead(id), listPhotos(id)]);
  const view = readViewOf(read, photos.map((p) => p.id));
  return NextResponse.json(
    { kind: view.kind, request: read?.request_no ?? 0 },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
