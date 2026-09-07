'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAreaCode, isElective, isPublishStatus, LMS, type Elective } from '@/config/lms';
import { assertRole, type SessionUser } from '@/lib/lms/auth';
import { courseVisibleTo, enroll, unenroll, type CourseRow } from '@/lib/lms/courses';
import {
  defaultQuestionRows,
  deleteExam,
  getExam,
  listQuestions,
  openAttempt,
  replaceQuestions,
  saveExam,
  saveGrading,
  getAttempt,
  type QuestionInput,
} from '@/lib/lms/exams';

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

async function assertCourse(courseId: string): Promise<{ user: SessionUser; course: CourseRow }> {
  const user = await assertRole('admin', 'tutor');
  const course = await courseVisibleTo(courseId, user);
  if (!course) redirect('/lms/tutor');
  return { user, course };
}

/** 회차를 통해 반을 찾아 확인한다. 문항표·채점이 전부 이 문을 지나간다. */
async function assertExam(examId: string) {
  const user = await assertRole('admin', 'tutor');
  const exam = await getExam(examId);
  if (!exam) redirect('/lms/tutor');
  const course = await courseVisibleTo(exam.course_id, user);
  if (!course) redirect('/lms/tutor');
  return { user, exam, course };
}

/* ────────────────────────────────────────────────────────── 수강생 */

export async function enrollStudent(formData: FormData): Promise<void> {
  const courseId = text(formData, 'course_id');
  await assertCourse(courseId);

  const studentId = text(formData, 'student_id');
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

  const examId = await saveExam({
    course_id: courseId,
    title,
    exam_date: optional(formData, 'exam_date'),
    status: 'draft',
  });

  // 45줄을 손으로 채우게 두지 않는다. 통상 배치를 미리 깔고 고칠 것만 고치게 한다.
  await replaceQuestions(examId, defaultQuestionRows(LMS.defaultQuestionCount));

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
    exam_date: optional(formData, 'exam_date'),
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

/* ────────────────────────────────────────────────────────── 문항표 */

/**
 * 문항표 저장.
 *
 * 칸 이름에 번호를 붙이지 않고 같은 이름을 반복해서 쓴다 — FormData.getAll() 이
 * 문서에 놓인 순서를 그대로 지키기 때문에, 줄을 중간에 넣거나 지워도 번호가 꼬이지 않는다.
 */
export async function saveQuestionTable(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  await assertExam(examId);

  const nos = formData.getAll('no').map((v) => Number(String(v)));
  const areas = formData.getAll('area_code').map((v) => String(v));
  const points = formData.getAll('points').map((v) => Number(String(v)));
  const answers = formData.getAll('answer').map((v) => String(v).trim());
  const passages = formData.getAll('passage').map((v) => String(v).trim());

  const rows: QuestionInput[] = [];
  const seen = new Set<string>();
  // 선택과목 두 벌 때문에 줄 수가 문항 수보다 많다. 상한도 그만큼 넉넉히 본다.
  const limit = LMS.maxQuestionCount * 2;
  for (let i = 0; i < nos.length && i < limit; i += 1) {
    const no = nos[i];
    if (!Number.isInteger(no) || no < 1 || no > LMS.maxQuestionCount) continue;
    if (!isAreaCode(areas[i] ?? '')) continue;

    /**
     * 같은 번호라도 영역이 다르면 다른 문항이다 — 35번 화작과 35번 언매는 함께 있어야 한다.
     * 번호와 영역이 둘 다 같은 줄만 실수로 보고 먼저 적힌 것을 남긴다.
     */
    const key = `${no}|${areas[i]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const answer = Number(answers[i]);
    rows.push({
      no,
      area_code: areas[i],
      points: Number.isFinite(points[i]) && points[i] >= 0 ? points[i] : 0,
      answer: Number.isInteger(answer) && answer >= 1 && answer <= 5 ? answer : null,
      passage: passages[i] || null,
    });
  }

  await replaceQuestions(examId, rows);
  revalidatePath(`/lms/exams/${examId}`);
  redirect(`/lms/exams/${examId}/questions?saved=1`);
}

export async function reseedQuestionTable(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  await assertExam(examId);

  const count = Math.min(Math.max(Number(text(formData, 'count')) || LMS.defaultQuestionCount, 1), LMS.maxQuestionCount);
  // 반에 화작·언매가 섞여 있으면 둘 다 고른다. 하나도 안 고르면 공통만 깐다.
  const electives = formData.getAll('elective').map(String).filter(isElective);

  await replaceQuestions(examId, defaultQuestionRows(count, electives));
  redirect(`/lms/exams/${examId}/questions?seeded=1`);
}

/* ────────────────────────────────────────────────────────────── 채점 */

/** 학생 한 명의 채점 화면을 연다. 없으면 그때 만든다. */
export async function startGrading(formData: FormData): Promise<void> {
  const examId = text(formData, 'exam_id');
  await assertExam(examId);

  const studentId = text(formData, 'student_id');
  if (!studentId) redirect(`/lms/exams/${examId}`);

  const attempt = await openAttempt(examId, studentId);
  redirect(`/lms/attempts/${attempt.id}`);
}

export async function submitGrading(formData: FormData): Promise<void> {
  const attemptId = text(formData, 'attempt_id');
  const attempt = await getAttempt(attemptId);
  if (!attempt) redirect('/lms/tutor');
  await assertExam(attempt.exam_id);

  const questions = await listQuestions(attempt.exam_id);

  /**
   * O 도 X 도 안 고른 문항은 행을 만들지 않는다. '틀림' 과 '아직 안 매김' 은 다르다 —
   * 섞으면 채점을 하다 만 회차가 0점으로 보인다.
   */
  const answers = questions
    .map((q) => {
      const mark = String(formData.get(`mark_${q.id}`) ?? '');
      if (mark !== 'o' && mark !== 'x') return null;
      const chosen = Number(String(formData.get(`chosen_${q.id}`) ?? ''));
      return {
        question_id: q.id,
        correct: mark === 'o',
        chosen: Number.isInteger(chosen) && chosen >= 1 && chosen <= 5 ? chosen : null,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const areaComments = [...new Set(questions.map((q) => q.area_code))].map((area_code) => ({
    area_code,
    comment: String(formData.get(`comment_${area_code}`) ?? ''),
  }));

  const status = text(formData, 'status');
  const elective = text(formData, 'elective');

  await saveGrading({
    attemptId,
    elective: isElective(elective) ? (elective as Elective) : null,
    answers,
    areaComments,
    overallComment: optional(formData, 'overall_comment'),
    status: isPublishStatus(status) ? status : 'draft',
  });

  revalidatePath(`/lms/exams/${attempt.exam_id}`);
  redirect(`/lms/attempts/${attemptId}?saved=1`);
}
