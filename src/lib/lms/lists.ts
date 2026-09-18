import 'server-only';
import { coursesOfStudent, type CourseRow } from './courses';
import { db, inChunks } from './db';
import {
  ATTEMPT_COLS,
  EXAM_COLS,
  submissionCounts,
  type AttemptRow,
  type ExamRow,
  type SubmissionCount,
} from './exams';

/**
 * 첫 화면의 목록 — 튜터의 할 일(답을 기다리는 제출)과 학생의 시험 목록.
 * 반 여러 개 · 회차 여러 개를 한 번에 읽어 앱에서 접는다.
 */

export type PendingItem = {
  attempt: AttemptRow;
  exam: ExamRow;
  courseId: string;
  studentName: string;
  counts: SubmissionCount;
};

/**
 * 답을 기다리는 제출. 튜터의 첫 화면에 기한 순으로 늘어놓는다.
 * 학생이 '제출' 했고 아직 보내지 않은 것만 — 쓰다 만 것까지 넣으면 할 일이 부풀어 보인다.
 */
export async function pendingFeedback(courseIds: string[]): Promise<PendingItem[]> {
  if (courseIds.length === 0) return [];

  const exams = await inChunks<ExamRow>(courseIds, (b) =>
    db().from('lms_exams').select(EXAM_COLS).in('course_id', b).order('id'));
  if (exams.length === 0) return [];

  const attempts = await inChunks<AttemptRow>(exams.map((e) => e.id), (b) =>
    db()
      .from('lms_attempts')
      .select(ATTEMPT_COLS)
      .in('exam_id', b)
      .not('submitted_at', 'is', null)
      .is('feedback_ready_at', null)
      .order('id'));
  if (attempts.length === 0) return [];

  const [counts, names] = await Promise.all([
    submissionCounts(attempts.map((a) => a.id)),
    inChunks<{ id: string; name: string }>([...new Set(attempts.map((a) => a.student_id))], (b) =>
      db().from('lms_users').select('id, name').in('id', b).order('id')),
  ]);
  const examById = new Map(exams.map((e) => [e.id, e]));
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  return attempts
    .map((attempt) => {
      const exam = examById.get(attempt.exam_id)!;
      return {
        attempt,
        exam,
        courseId: exam.course_id,
        studentName: nameById.get(attempt.student_id) ?? '(지운 계정)',
        counts: counts.get(attempt.id) ?? { photos: 0, concerns: 0, answered: 0 },
      };
    })
    .sort(
      (a, b) =>
        (a.exam.due_date ?? '9999').localeCompare(b.exam.due_date ?? '9999') ||
        (a.attempt.submitted_at ?? '').localeCompare(b.attempt.submitted_at ?? ''),
    );
}

export type StudentExamItem = {
  exam: ExamRow;
  course: CourseRow;
  attempt: AttemptRow | null;
  counts: SubmissionCount;
};

/** 학생 화면의 시험 목록. 자기 반의 '학생에게 열림' 회차만, 최근 것부터. */
export async function studentExams(studentId: string): Promise<StudentExamItem[]> {
  const courses = await coursesOfStudent(studentId);
  if (courses.length === 0) return [];

  const exams = await inChunks<ExamRow>(courses.map((c) => c.id), (b) =>
    db()
      .from('lms_exams')
      .select(EXAM_COLS)
      .in('course_id', b)
      .eq('status', 'published')
      .order('id'));
  if (exams.length === 0) return [];

  const attempts = await inChunks<AttemptRow>(exams.map((e) => e.id), (b) =>
    db().from('lms_attempts').select(ATTEMPT_COLS).in('exam_id', b).eq('student_id', studentId).order('id'));
  const counts = await submissionCounts(attempts.map((a) => a.id));

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const attemptByExam = new Map(attempts.map((a) => [a.exam_id, a]));
  const none: SubmissionCount = { photos: 0, concerns: 0, answered: 0 };

  return exams
    .map((exam) => {
      const attempt = attemptByExam.get(exam.id) ?? null;
      return {
        exam,
        course: courseById.get(exam.course_id)!,
        attempt,
        counts: (attempt && counts.get(attempt.id)) || none,
      };
    })
    .sort((a, b) =>
      (b.exam.exam_date ?? b.exam.created_at).localeCompare(a.exam.exam_date ?? a.exam.created_at),
    );
}
