import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { getAttempt, getExam } from '@/lib/lms/exams';
import { buildFeedback, feedbackPdfOf, renderFeedback } from '@/lib/lms/feedback';
import { feedbackFileName } from '@/lib/lms/mail';
import { pdfResponse } from '@/lib/lms/pdf/response';

export const dynamic = 'force-dynamic';

/**
 * 튜터가 보는 답변 PDF.
 *
 *   기본       지금 저장된 답으로 새로 만든다 — 보내기 전에 모양을 확인하는 미리 보기다.
 *   ?sent=1    학생에게 실제로 간 파일을 그대로 연다.
 *
 * 서버 함수는 파일을 내려보내지 못해서 라우트다. 그래서 잠금을 여기서 다시 건다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== 'tutor' && user.role !== 'admin')) {
    return new NextResponse('로그인이 필요해요', { status: 401 });
  }

  const { id } = await params;
  const attempt = await getAttempt(id);
  const exam = attempt ? await getExam(attempt.exam_id) : null;
  if (!attempt || !exam || !(await courseVisibleTo(exam.course_id, user))) {
    return new NextResponse('없는 응시예요', { status: 404 });
  }

  if (new URL(request.url).searchParams.has('sent')) {
    const sent = await feedbackPdfOf(attempt);
    if (!sent) return new NextResponse('아직 보낸 PDF 가 없어요', { status: 404 });
    return pdfResponse(sent, 'feedback.pdf', 'inline');
  }

  const built = await buildFeedback(id);
  if (!built) return new NextResponse('없는 응시예요', { status: 404 });
  // 싣지 못한 풀이 사진은 그 자리에 글로 적혀 나온다. 보내기는 거기서 멈춘다 (sendFeedback).
  return pdfResponse(
    (await renderFeedback(built)).pdf,
    `[미리보기] ${feedbackFileName(built.exam.title, built.student.name)}`,
    'inline',
  );
}
