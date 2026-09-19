import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/lms/auth';
import { getUser } from '@/lib/lms/users';
import { isEnrolled } from '@/lib/lms/courses';
import { findAttempt, getExam } from '@/lib/lms/exams';
import { feedbackPdfOf } from '@/lib/lms/feedback';
import { feedbackFileName } from '@/lib/lms/mail';
import { pdfResponse } from '@/lib/lms/pdf/response';

export const dynamic = 'force-dynamic';

/**
 * 학생이 받는 답변 PDF. 메일이 안 갔거나 지웠어도 여기서 다시 받는다.
 *
 * 응시 id 를 주소에 싣지 않는다 — 회차와 로그인한 사람으로 찾으니 남의 PDF 를 가리킬 길이 없다.
 * 회차가 '학생에게 열림' 이 아니면 없는 것과 같이 다룬다(점수와 같은 규칙).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== 'student') return new NextResponse('로그인이 필요해요', { status: 401 });

  const { examId } = await params;
  const exam = await getExam(examId);
  if (!exam || exam.status !== 'published' || !(await isEnrolled(exam.course_id, user.id))) {
    return new NextResponse('없는 시험이에요', { status: 404 });
  }

  const attempt = await findAttempt(exam.id, user.id);
  const bytes = attempt ? await feedbackPdfOf(attempt) : null;
  if (!bytes) return new NextResponse('아직 받은 답이 없어요', { status: 404 });

  const me = await getUser(user.id);
  return pdfResponse(bytes, feedbackFileName(exam.title, me?.name ?? user.name), 'attachment');
}
