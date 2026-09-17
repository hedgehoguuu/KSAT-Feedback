'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  CONCERN,
  LMS,
  PAPER,
  addDays,
  isPublishStatus,
  parseAnswer,
  passwordProblem,
  unitFits,
} from '@/config/lms';
import { assertRole, type SessionUser } from '@/lib/lms/auth';
import { courseVisibleTo, enroll, isEnrolled, studentVisibleTo, unenroll, type CourseRow } from '@/lib/lms/courses';
import {
  deleteExam,
  getAttempt,
  getExam,
  listQuestions,
  openAttempt,
  publishGradedAttempts,
  saveAnswerKey,
  saveExam,
  saveGrading,
  type AttemptRow,
  type ExamRow,
} from '@/lib/lms/exams';
import {
  clearAnswerImage,
  listConcerns,
  saveConcernAnswers,
  sendFeedback,
  setAnswerImage,
} from '@/lib/lms/feedback';
import { readAnswerKey, type OcrResult } from '@/lib/lms/ocr';
import { applyPhotoRead, requestPhotoRead } from '@/lib/lms/photo-read';
import { readJpeg } from '@/lib/lms/upload';
import { resetPassword } from '@/lib/lms/users';

/**
 * 반을 가르치는 쪽의 쓰기 전부. 튜터와 관리자가 함께 쓴다.
 *
 * 모든 함수가 맨 앞에서 '이 사람이 이 반의 주인인가' 를 확인한다. 주소창에 남의 반
 * id 를 넣어 부르는 것을 막는 건 화면이 아니라 여기다.
 */

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const v = text(form, key);
  return v.length > 0 ? v : null;
}

/** YYYY-MM-DD 만 받는다. 브라우저 date 칸은 이 모양을 보내지만 손으로 바꾼 요청은 아닐 수 있다. */
function dateOf(form: FormData, key: string): string | null {
  const v = text(form, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function assertCourse(courseId: string): Promise<{ user: SessionUser; course: CourseRow }> {
  const user = await assertRole('admin', 'tutor');
  const course = await courseVisibleTo(courseId, user);
  if (!course) redirect('/lms/tutor');
  return { user, course };
}

/** 회차를 통해 반을 찾아 확인한다. 정답표·채점이 전부 이 문을 지나간다. */
async function assertExam(examId: string): Promise<{ user: SessionUser; exam: ExamRow; course: CourseRow }> {
  const user = await assertRole('admin', 'tutor');
  const exam = await getExam(examId);
  if (!exam) redirect('/lms/tutor');
  const course = await courseVisibleTo(exam.course_id, user);
  if (!course) redirect('/lms/tutor');
  return { user, exam, course };
}

/** 응시를 통해 반을 찾아 확인한다. 질문 답변이 전부 이 문을 지나간다. */
async function assertAttempt(attemptId: string): Promise<{ attempt: AttemptRow; exam: ExamRow; course: CourseRow }> {
  const attempt = attemptId ? await getAttempt(attemptId) : null;
  if (!attempt) redirect('/lms/tutor');
  const { exam, course } = await assertExam(attempt.exam_id);
  return { attempt, exam, course };
}

/* ────────────────────────────────────────────────────────── 수강생 */

export async function enrollStudent(formData: FormData): Promise<void> {
  const courseId = text(formData, 'course_id');
  await assertCourse(courseId);

  const studentId = text(formData, 'student_id');
  // 학생 계정이 아니면 enroll 이 넣지 않고 'NOT_STUDENT' 를 돌려준다. 화면은 학생만 고르게
  // 하므로 여기 닿는 건 손으로 바꾼 요청뿐이다 — 따로 안내하지 않고 돌려보낸다.
  if (studentId) await enroll(courseId, studentId);

  revalidatePath(`/lms/courses/${courseId}`);
  redirect(`/lms/courses/${courseId}`);
}

export async function removeStudent(formData: FormData): Promise<void> {
  const courseId = text(formData, 'course_id');
  await assertCourse(courseId);

  const studentId = text(formData, 'student_id');
  if (studentId) await unenroll(courseId, studentId);

  revalidatePath(`/lms/courses/${courseId}`);
  redirect(`/lms/courses/${courseId}`);
}

/* ────────────────────────────────────────────────────────── 시험 회차 */

export async function createExam(formData: FormData): Promise<void> {
  const courseId = text(formData, 'course_id');
  await assertCourse(courseId);

  const title = text(formData, 'title');
  if (!title) redirect(`/lms/courses/${courseId}?error=title`);

  const examDate = dateOf(formData, 'exam_date');
  const examId = await saveExam({
    course_id: courseId,
    title,
    exam_date: examDate,
    // 비워 두면 시험 날 + 7일. 수업이 주 1회라 다음 수업 날이다.
    due_date: dateOf(formData, 'due_date') ?? (examDate ? addDays(examDate, LMS.replyDays) : null),
    status: 'draft',
  });

  revalidatePath(`/lms/courses/${courseId}`);
  redirect(`/lms/exams/${examId}/questions?new=1`);
}

export async function updateExam(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  const { exam } = await assertExam(examId);

  const status = text(formData, 'status');
  await saveExam({
    id: examId,
    course_id: exam.course_id,
    title: text(formData, 'title') || exam.title,
    exam_date: dateOf(formData, 'exam_date'),
    due_date: dateOf(formData, 'due_date'),
    status: isPublishStatus(status) ? status : exam.status,
  });

  revalidatePath(`/lms/exams/${examId}`);
  redirect(`/lms/exams/${examId}?saved=1`);
}

export async function removeExam(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  const { exam } = await assertExam(examId);

  await deleteExam(examId);
  revalidatePath(`/lms/courses/${exam.course_id}`);
  redirect(`/lms/courses/${exam.course_id}`);
}

/* ────────────────────────────────────────────────────────── 정답표 */

/**
 * 정답표 저장. 칸 이름은 `answer_{번호}` · `unit_{번호}` 다 — 번호가 곧 문항이라 줄이 밀릴 일이 없다.
 *
 * 적어 둔 값이 그 번호에 올 수 없는 답이면(5지선다에 7) 저장하지 않고 돌려보낸다.
 * 그 칸만 빼고 저장하면 튜터는 저장된 줄 알고, 그 문항은 '정답 없음' 으로 채점에서 헛돈다.
 */
export async function saveAnswerKeyForm(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  await assertExam(examId);

  const bad: number[] = [];
  const key = PAPER.map((q) => {
    const raw = text(formData, `answer_${q.no}`);
    const answer = parseAnswer(q.no, raw);
    if (raw && answer === null) bad.push(q.no);
    const unit = text(formData, `unit_${q.no}`);
    return { no: q.no, answer, unit_code: unitFits(q.no, unit) ? unit : null };
  });
  if (bad.length > 0) redirect(`/lms/exams/${examId}/questions?error=answer&nos=${bad.join(',')}`);

  const regraded = await saveAnswerKey(examId, key);
  revalidatePath(`/lms/exams/${examId}`);
  redirect(`/lms/exams/${examId}/questions?saved=1&regraded=${regraded}`);
}

/**
 * 정답표 사진을 읽어 초안을 돌려준다. **저장하지 않는다** — 칸에 채워 넣기만 하고,
 * 튜터가 눈으로 보고 저장을 눌러야 DB 로 간다. 사진도 서버에 남기지 않는다.
 */
export async function extractAnswerKey(formData: FormData): Promise<OcrResult> {
  const examId = text(formData, 'exam_id');
  await assertExam(examId);

  const files = formData.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, reason: 'NO_IMAGE' };

  // 한 번에 너무 많이 보내면 느리기만 하고 정확해지지 않는다. 정답표는 대개 한두 장이다.
  const images = await Promise.all(
    files.slice(0, 4).map(async (file) => ({
      media_type: file.type || 'image/jpeg',
      data: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })),
  );

  return readAnswerKey(images);
}

/* ────────────────────────────────────────────────────────────── 채점 */

/** 학생 한 명의 채점 화면을 연다. 없으면 그때 만든다. */
export async function startGrading(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  const { course } = await assertExam(examId);

  /**
   * 이 반 수강생만. 회차가 내 반인지만 보면, id 를 손으로 바꿔 보냈을 때 남의 반 학생의
   * 응시가 이 회차에 생긴다 — 공개하면 그 학생 화면에 모르는 반의 성적이 뜬다.
   */
  const studentId = text(formData, 'student_id');
  if (!studentId || !(await isEnrolled(course.id, studentId))) redirect(`/lms/exams/${examId}`);

  const attempt = await openAttempt(examId, studentId);
  const to = text(formData, 'to') === 'feedback' ? `/lms/attempts/${attempt.id}/feedback` : `/lms/attempts/${attempt.id}`;
  redirect(to);
}

/**
 * 채점 한 판을 저장한다. 화면이 그릴 때 본 판(rev)이 아직 최신일 때만 — 그사이 학생이
 * 사진을 바꿔 사진으로 매긴 채점이 비워졌으면 'STALE' 을 돌려주고 아무것도 쓰지 않는다.
 * 그때는 화면을 넘기지 않는다. 튜터가 방금 매긴 것을 날리지 않고 안내만 띄운다.
 */
export async function submitGrading(_state: 'STALE' | null, formData: FormData): Promise<'STALE' | null> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));
  const questions = await listQuestions(attempt.exam_id);

  /**
   * 문항마다 O/X 와 학생이 적은 답을 받는다.
   *
   * O/X 를 안 골랐어도 학생 답이 있고 정답이 있으면 그 둘로 매긴다 — 화면도 그렇게 보여 준다.
   * 둘 다 없으면 행을 만들지 않는다. '틀림' 과 '아직 안 매김' 은 다르다 — 섞으면
   * 채점을 하다 만 회차가 0점으로 보인다.
   */
  const answers = questions
    .map((q) => {
      const chosen = parseAnswer(q.no, text(formData, `chosen_${q.id}`));
      const mark = text(formData, `mark_${q.id}`);
      const correct =
        mark === 'o' ? true : mark === 'x' ? false : chosen !== null && q.answer !== null ? chosen === q.answer : null;
      return correct === null ? null : { question_id: q.id, correct, chosen };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const status = text(formData, 'status');
  const outcome = await saveGrading({
    attemptId: attempt.id,
    answers,
    overallComment: optional(formData, 'overall_comment'),
    status: isPublishStatus(status) ? status : 'draft',
    rev: optional(formData, 'rev'),
  });
  if (outcome === 'STALE') return 'STALE';

  revalidatePath(`/lms/exams/${attempt.exam_id}`);
  redirect(`/lms/attempts/${attempt.id}?saved=1`);
}

/**
 * 학생 시험지 사진을 지금 다시 읽는다. 기다리지 않고 바로 읽고, 학생 쪽 횟수 상한도 없다.
 * 읽기는 응답을 보낸 뒤 뒤에서 돈다 — 채점 화면이 끝날 때까지 상태를 보여 준다.
 */
export async function rereadPhotos(formData: FormData): Promise<void> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));
  const outcome = await requestPhotoRead(attempt.id, { by: 'tutor' });

  revalidatePath(`/lms/exams/${attempt.exam_id}`);
  redirect(`/lms/attempts/${attempt.id}?read=${outcome === 'QUEUED' ? 'queued' : 'off'}`);
}

/**
 * 사진에서 읽은 답으로 채점을 다시 채운다. 튜터가 매긴 채점도 덮는다 — 화면이 한 번 묻는다.
 * 총평은 그대로 둔다. 점수를 공개한 응시는 DB 가 막는다.
 */
export async function applyPhotoReadForm(formData: FormData): Promise<void> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));
  const graded = await applyPhotoRead(attempt.id, true);

  revalidatePath(`/lms/exams/${attempt.exam_id}`);
  redirect(`/lms/attempts/${attempt.id}?read=${graded >= 0 ? 'applied' : 'kept'}`);
}

/** 채점이 끝난 학생을 한 번에 공개한다. 매기다 만 응시는 건드리지 않는다. */
export async function publishExamGrades(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  const { exam } = await assertExam(examId);

  const { published, skipped } = await publishGradedAttempts(exam);

  revalidatePath(`/lms/exams/${examId}`);
  redirect(`/lms/exams/${examId}?published=${published}&skipped=${skipped}`);
}

/* ──────────────────────────────────────────────────────── 질문에 답하기 */

/**
 * 답을 저장한다. `intent=send` 면 저장한 다음 답변 PDF 를 만들어 보낸다.
 *
 * 저장과 보내기를 한 번에 하는 이유: 마지막 답을 쓰고 '보내기' 만 누르면 그 답이 저장되기
 * 전의 상태로 PDF 가 나간다. 튜터는 방금 쓴 답이 들어갔다고 믿는다.
 */
export async function saveFeedbackAnswers(formData: FormData): Promise<void> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));
  const base = `/lms/attempts/${attempt.id}/feedback`;

  const concerns = await listConcerns(attempt.id);
  const answers = concerns
    .filter((c) => formData.has(`answer_${c.id}`))
    .map((c) => ({ id: c.id, answer: String(formData.get(`answer_${c.id}`) ?? '').replace(/\r\n?/g, '\n').trim() }));

  if (answers.some((a) => Array.from(a.answer).length > CONCERN.maxAnswer)) redirect(`${base}?error=long`);
  if (answers.length > 0) await saveConcernAnswers(attempt.id, answers);

  revalidatePath(base);
  revalidatePath(`/lms/exams/${attempt.exam_id}`);
  if (text(formData, 'intent') !== 'send') redirect(`${base}?saved=1`);

  const outcome = await sendFeedback(attempt.id);
  if (!outcome.ok) {
    const missing = outcome.missing?.length ? `&missing=${outcome.missing.join(',')}` : '';
    redirect(`${base}?error=${outcome.reason}${missing}`);
  }

  revalidatePath('/lms/tutor');
  redirect(`${base}?sent=1&mail=${outcome.mail.status}${outcome.published ? '&published=1' : ''}`);
}

export type UploadResult = { ok: true } | { ok: false; reason: string };

/** 손으로 쓴 풀이 사진을 붙인다. 브라우저가 줄여서 한 장씩 보낸다. */
export async function uploadAnswerImage(formData: FormData): Promise<UploadResult> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));

  const image = await readJpeg(formData.get('photo'));
  if (!image.ok) return image;

  const done = await setAnswerImage(attempt.id, text(formData, 'concern_id'), image.bytes);
  if (done === 'NOT_FOUND') return { ok: false, reason: 'NOT_FOUND' };

  revalidatePath(`/lms/attempts/${attempt.id}/feedback`);
  return { ok: true };
}

/**
 * 풀이 사진을 뗀다. 폼 제출로 하지 않는다 — 그러면 옆 칸에 쓰던 답이 저장 없이 날아간다.
 * 브라우저 부품이 불러서 그 자리만 고친다.
 */
export async function removeAnswerImage(formData: FormData): Promise<UploadResult> {
  const { attempt } = await assertAttempt(text(formData, 'attempt_id'));
  await clearAnswerImage(attempt.id, text(formData, 'concern_id'));

  revalidatePath(`/lms/attempts/${attempt.id}/feedback`);
  return { ok: true };
}

/* ─────────────────────────────────────────────── 되풀이를 줄여 주는 것들 */

/**
 * 튜터가 자기 반 학생의 비밀번호를 새로 발급한다.
 *
 * 관리자만 할 수 있게 두면 학생이 비번을 잊은 날 수업이 멈춘다. 대신 자기 반 학생인지를
 * 반드시 확인한다 — 없으면 튜터가 학생 id 만 알면 남의 반 학생 비밀번호를 바꿀 수 있다.
 */
export async function resetStudentPassword(formData: FormData): Promise<void> {
  const user = await assertRole('admin', 'tutor');

  const studentId = text(formData, 'student_id');
  const courseId = text(formData, 'course_id');
  const password = String(formData.get('password') ?? '');

  if (!(await studentVisibleTo(studentId, user))) redirect('/lms/tutor');
  if (passwordProblem(password)) redirect(`/lms/courses/${courseId}?error=weak`);

  if (!(await resetPassword(studentId, password, { studentOnly: true }))) redirect('/lms/tutor');
  redirect(`/lms/courses/${courseId}?reset=${encodeURIComponent(studentId)}`);
}
