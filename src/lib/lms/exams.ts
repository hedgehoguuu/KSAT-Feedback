import 'server-only';
import { PAPER, type PublishStatus } from '@/config/lms';
import { listEnrolled } from './courses';
import { db, inChunks, must, one, rows } from './db';
import { removeFilesOfExams } from './files';
import type { GradingSnapshot } from './grading-snapshot';
import {
  classAverageOf,
  courseStats,
  scoreAttempt,
  scoreShown,
  trendsOf,
  type AnswerRow,
  type AttemptScore,
  type ClassAverage,
  type CourseStats,
  type QuestionRow,
  type Trends,
} from './score';
import { getStudent, type StudentRow } from './users';

export type ExamRow = {
  id: string;
  course_id: string;
  title: string;
  exam_date: string | null;
  /** 다음 수업 날 — 학생 질문에 답을 달 기한 */
  due_date: string | null;
  status: PublishStatus;
  created_at: string;
};

export type AttemptRow = {
  id: string;
  exam_id: string;
  student_id: string;
  overall_comment: string | null;
  /** 0016 시절의 '점수 공개' 표시. 0020 부터 읽지도 쓰지도 않는다 — 보일지는 scoreShown 이 정한다. */
  status: PublishStatus;
  updated_at: string;
  /** 학생이 사진·질문을 '제출' 한 첫 시각 */
  submitted_at: string | null;
  feedback_path: string | null;
  /** 튜터가 답을 다 달아 PDF 를 보낸 시각. 이때부터 학생이 받고, 학생 쪽은 잠긴다. */
  feedback_ready_at: string | null;
  mailed_at: string | null;
  mailed_to: string | null;
  mail_error: string | null;
  /**
   * 채점을 누가 적었나. tutor = 선생님이 채점 화면에서 저장함 · null = 아직 아무도.
   * photo 는 0016 시절 학생 사진에서 읽어 채우고 아직 확인하지 않은 채점이다 — 학생에게 안 보인다.
   */
  answers_source: AnswersSource | null;
};

export type AnswersSource = 'photo' | 'tutor';

export const EXAM_COLS = 'id, course_id, title, exam_date, due_date, status, created_at';
const QUESTION_COLS = 'id, no, points, answer, unit_code';
// 한 덩어리로 적는다. 문자열을 더해 만들면 supabase-js 가 열 목록을 못 읽어 타입이 오류로 바뀐다.
export const ATTEMPT_COLS =
  'id, exam_id, student_id, overall_comment, status, updated_at, submitted_at, feedback_path, feedback_ready_at, mailed_at, mailed_to, mail_error, answers_source';

/* ─────────────────────────────────────────────────────────── 시험 회차 */

export async function listExams(courseId: string): Promise<ExamRow[]> {
  return await rows<ExamRow>(
    db()
      .from('lms_exams')
      .select(EXAM_COLS)
      .eq('course_id', courseId)
      // 날짜를 안 적은 회차가 맨 아래로 가지 않도록 만든 순서를 보조로 쓴다.
      .order('exam_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  );
}

export async function getExam(id: string): Promise<ExamRow | null> {
  return await one<ExamRow>(db().from('lms_exams').select(EXAM_COLS).eq('id', id).maybeSingle());
}

export async function saveExam(input: {
  id?: string;
  course_id: string;
  title: string;
  exam_date: string | null;
  due_date: string | null;
  status: PublishStatus;
}): Promise<string> {
  const row = {
    title: input.title.trim(),
    exam_date: input.exam_date,
    due_date: input.due_date,
    status: input.status,
  };

  if (input.id) {
    await must(db().from('lms_exams').update(row).eq('id', input.id));
    return input.id;
  }

  const { data, error } = await db()
    .from('lms_exams')
    .insert({ ...row, course_id: input.course_id })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('LMS_CREATE_EXAM_FAILED');

  // 시험지 모양은 정해져 있으니 1–30 번을 바로 깐다. 튜터는 정답만 넣으면 된다.
  await seedQuestions(data.id);
  return data.id;
}

/** 회차를 지운다. 학생 사진과 답변 PDF 를 먼저 지우고, 그다음 줄을 지운다. */
export async function deleteExam(id: string): Promise<void> {
  await removeFilesOfExams([id]);
  await must(db().from('lms_exams').delete().eq('id', id));
}

/* ─────────────────────────────────────────────────────────── 문항표 */

export async function listQuestions(examId: string): Promise<QuestionRow[]> {
  const found = await rows<QuestionRow>(
    db().from('lms_exam_questions').select(QUESTION_COLS).eq('exam_id', examId).order('no'),
  );
  return found.map((q) => ({ ...q, points: Number(q.points) }));
}

export type AnswerKeyInput = { no: number; answer: number | null; unit_code: string | null };

/**
 * 정답표를 저장한다. 배점은 받지 않는다 — 번호로 정해진다 (config/lms.ts 의 PAPER).
 *
 * 정답을 고친 문항은 DB 가 적어 둔 학생 답으로 다시 매긴다 (0015 save_answer_key).
 * 정답을 잘못 넣은 채 채점을 끝냈다가 고치는 일이 실제로 생기는데, 그때 채점을 처음부터
 * 다시 하게 두면 아무도 안 한다. 돌려주는 값은 다시 매긴 정오의 수다.
 */
export async function saveAnswerKey(examId: string, key: AnswerKeyInput[]): Promise<number> {
  const byNo = new Map(key.map((k) => [k.no, k]));
  const { data, error } = await db().rpc('save_answer_key', {
    payload: {
      exam_id: examId,
      rows: PAPER.filter((q) => byNo.has(q.no)).map((q) => {
        const k = byNo.get(q.no)!;
        return {
          no: q.no,
          points: q.points,
          answer: k.answer === null ? '' : String(k.answer),
          unit_code: k.unit_code ?? '',
        };
      }),
    },
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * 비어 있는 번호에 줄을 깐다. 있는 줄의 정답은 건드리지 않는다 —
 * 없는 번호만 넘기고, DB 함수는 넘어온 번호만 만진다.
 */
export async function seedQuestions(examId: string): Promise<void> {
  const have = new Set((await listQuestions(examId)).map((q) => q.no));
  const missing = PAPER.filter((q) => !have.has(q.no));
  if (missing.length === 0) return;
  await saveAnswerKey(
    examId,
    missing.map((q) => ({ no: q.no, answer: null, unit_code: null })),
  );
}

/* ─────────────────────────────────────────────────────────── 응시 */

export async function listAttempts(examId: string): Promise<AttemptRow[]> {
  return await rows<AttemptRow>(db().from('lms_attempts').select(ATTEMPT_COLS).eq('exam_id', examId));
}

export async function getAttempt(id: string): Promise<AttemptRow | null> {
  return await one<AttemptRow>(db().from('lms_attempts').select(ATTEMPT_COLS).eq('id', id).maybeSingle());
}

export async function findAttempt(examId: string, studentId: string): Promise<AttemptRow | null> {
  return await one<AttemptRow>(
    db()
      .from('lms_attempts')
      .select(ATTEMPT_COLS)
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .maybeSingle(),
  );
}

/**
 * 이 학생의 이 회차 응시를 가져오거나 만든다. 튜터가 채점을 열 때, 학생이 사진이나
 * 질문을 처음 올릴 때 생긴다 — 둘 중 먼저 온 쪽이 만들고 나머지는 그걸 쓴다.
 */
export async function openAttempt(examId: string, studentId: string): Promise<AttemptRow> {
  const found = await findAttempt(examId, studentId);
  if (found) return found;

  const { data, error } = await db()
    .from('lms_attempts')
    .insert({ exam_id: examId, student_id: studentId })
    .select(ATTEMPT_COLS)
    .single();

  // 튜터와 학생이 동시에 열면 unique 에 걸린다. 그때는 먼저 만들어진 것을 쓴다.
  if (error?.code === '23505') {
    const raced = await findAttempt(examId, studentId);
    if (raced) return raced;
  }
  if (error || !data) throw error ?? new Error('LMS_OPEN_ATTEMPT_FAILED');
  return data as unknown as AttemptRow;
}

export async function listAnswers(attemptId: string): Promise<AnswerRow[]> {
  return await rows<AnswerRow>(
    db().from('lms_answers').select('question_id, correct, chosen').eq('attempt_id', attemptId),
  );
}

/**
 * 채점 한 판을 통째로 저장한다 (0012 → 0015 → 0016 → 0017 save_grading).
 *
 * plpgsql 함수는 통째로 한 트랜잭션이라 중간에 실패하면 전부 되돌아간다. 예전에 요청 네
 * 번으로 나눠 하다가 82점 · 정오 45개가 0점 · 0개가 되고도 '저장했어요' 라고 말한 적이 있다.
 * 그래서 error 를 반드시 던진다 — 저장이 안 됐는데 됐다고 말하는 것이 가장 나쁘다.
 *
 * 한 문항이라도 매겨 저장하면 선생님 채점이 된다. 30문항을 다 매겼으면 그 순간부터 학생에게
 * 보인다 (score.ts 의 scoreShown) — 따로 공개하는 단계는 없다.
 *
 * base 는 화면이 그릴 때 본 정오와 정답표다 (grading-snapshot.ts). DB 가 응시를 잠근 뒤
 * 지금 것과 견줘, 다르면 아무것도 쓰지 않고 'STALE' 을 돌려준다 — 다른 창에서 먼저 저장했거나
 * 정답표를 고쳐 다시 매겨졌을 때다. 여기서 최신 판을 다시 읽어 넘기면 막는 뜻이 없다 —
 * 화면이 본 판이어야 한다. base 없이 부르면 견주지 않는다(시험용).
 */
export async function saveGrading(input: {
  attemptId: string;
  answers: { question_id: string; correct: boolean; chosen: number | null }[];
  overallComment: string | null;
  base: GradingSnapshot | null;
}): Promise<'SAVED' | 'STALE'> {
  const { error } = await db().rpc('save_grading', {
    payload: {
      attempt_id: input.attemptId,
      overall_comment: input.overallComment,
      ...(input.base ? { base: input.base } : {}),
      answers: input.answers.map((a) => ({
        question_id: a.question_id,
        correct: a.correct,
        chosen: a.chosen === null ? '' : String(a.chosen),
      })),
    },
  });

  if (error?.code === 'P0001' && error.message === 'STALE') return 'STALE';
  if (error) throw error;
  return 'SAVED';
}

/* ────────────────────────────────────────────────── 화면이 통째로 쓰는 것 */

/** 채점 화면 한 장에 필요한 것 전부. */
export async function loadGrading(attemptId: string): Promise<{
  attempt: AttemptRow;
  exam: ExamRow;
  student: StudentRow;
  questions: QuestionRow[];
  answers: AnswerRow[];
  score: AttemptScore;
} | null> {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;

  const [exam, student, questions, answers] = await Promise.all([
    getExam(attempt.exam_id),
    getStudent(attempt.student_id),
    listQuestions(attempt.exam_id),
    listAnswers(attemptId),
  ]);
  if (!exam || !student) return null;

  return { attempt, exam, student, questions, answers, score: scoreAttempt(questions, answers) };
}

/** 학생 한 명이 올린 것의 크기. 반 화면에서 누가 냈고 누구 답을 다 달았는지 본다. */
export type SubmissionCount = { photos: number; concerns: number; answered: number };

export async function submissionCounts(attemptIds: string[]): Promise<Map<string, SubmissionCount>> {
  const out = new Map<string, SubmissionCount>(
    attemptIds.map((id) => [id, { photos: 0, concerns: 0, answered: 0 }]),
  );
  if (attemptIds.length === 0) return out;

  const [photos, concerns] = await Promise.all([
    inChunks<{ attempt_id: string }>(attemptIds, (b) =>
      db().from('lms_attempt_photos').select('attempt_id').in('attempt_id', b).order('id')),
    inChunks<{ attempt_id: string; answer: string | null; answer_image_path: string | null }>(attemptIds, (b) =>
      db()
        .from('lms_concerns')
        .select('attempt_id, answer, answer_image_path')
        .in('attempt_id', b)
        .order('id')),
  ]);

  for (const p of photos) out.get(p.attempt_id)!.photos += 1;
  for (const c of concerns) {
    const count = out.get(c.attempt_id)!;
    count.concerns += 1;
    if (c.answer || c.answer_image_path) count.answered += 1;
  }
  return out;
}

export type BoardRow = {
  student: StudentRow;
  attempt: AttemptRow | null;
  score: AttemptScore;
  submission: SubmissionCount;
};

/**
 * 한 회차의 반 전체. 아직 응시 행이 없는 학생도 빈 성적으로 넣는다 —
 * 명단에서 빠지면 누구를 아직 안 매겼는지, 누가 아직 안 냈는지 알 수 없다.
 */
export async function examBoard(exam: ExamRow): Promise<{
  questions: QuestionRow[];
  rows: BoardRow[];
  stats: CourseStats;
}> {
  const [questions, students, attempts] = await Promise.all([
    listQuestions(exam.id),
    listEnrolled(exam.course_id),
    listAttempts(exam.id),
  ]);

  const byStudent = new Map(attempts.map((a) => [a.student_id, a]));
  const attemptIds = attempts.map((a) => a.id);
  const [answerRows, counts] = await Promise.all([
    inChunks<AnswerRow & { attempt_id: string }>(attemptIds, (batch) =>
      db()
        .from('lms_answers')
        .select('attempt_id, question_id, correct, chosen')
        .in('attempt_id', batch)
        .order('attempt_id')
        .order('question_id')),
    submissionCounts(attemptIds),
  ]);

  const answersByAttempt = groupAnswers(answerRows);
  const empty: SubmissionCount = { photos: 0, concerns: 0, answered: 0 };

  const boardRows = students.map((student) => {
    const attempt = byStudent.get(student.id) ?? null;
    const score = scoreAttempt(questions, attempt ? (answersByAttempt.get(attempt.id) ?? []) : []);
    return { student, attempt, score, submission: (attempt && counts.get(attempt.id)) || empty };
  });

  return {
    questions,
    rows: boardRows,
    stats: courseStats(
      boardRows.map((r) => ({
        studentId: r.student.id,
        name: r.student.name,
        score: r.score,
        counted: Boolean(r.attempt && scoreShown(r.attempt, r.score)),
      })),
    ),
  };
}

/**
 * 회차마다 반 평균 (점). 학생 화면이 쓴다 — 학생에게는 반 평균 말고 아무것도 넘기지 않는다.
 * 학생에게 보이는 채점(scoreShown)만 센다. 채점이 끝난 학생이 둘 미만인 회차는 빠진다.
 */
export async function examAverages(examIds: readonly string[]): Promise<Map<string, ClassAverage>> {
  const out = new Map<string, ClassAverage>();
  if (examIds.length === 0) return out;

  const [questionRows, attempts] = await Promise.all([
    inChunks<QuestionRow & { exam_id: string }>([...examIds], (b) =>
      db().from('lms_exam_questions').select(`exam_id, ${QUESTION_COLS}`).in('exam_id', b).order('no').order('id')),
    inChunks<Pick<AttemptRow, 'id' | 'exam_id' | 'answers_source'>>([...examIds], (b) =>
      db()
        .from('lms_attempts')
        .select('id, exam_id, answers_source')
        .in('exam_id', b)
        .eq('answers_source', 'tutor')
        .order('id')),
  ]);
  const answerRows = await inChunks<AnswerRow & { attempt_id: string }>(attempts.map((a) => a.id), (b) =>
    db()
      .from('lms_answers')
      .select('attempt_id, question_id, correct, chosen')
      .in('attempt_id', b)
      .order('attempt_id')
      .order('question_id'));

  const questionsByExam = groupQuestions(questionRows);
  const answersByAttempt = groupAnswers(answerRows);
  const scoresByExam = new Map<string, AttemptScore[]>();
  for (const attempt of attempts) {
    const score = scoreAttempt(questionsByExam.get(attempt.exam_id) ?? [], answersByAttempt.get(attempt.id) ?? []);
    if (!scoreShown(attempt, score)) continue;
    scoresByExam.set(attempt.exam_id, [...(scoresByExam.get(attempt.exam_id) ?? []), score]);
  }
  for (const [examId, scores] of scoresByExam) {
    const average = classAverageOf(scores);
    if (average) out.set(examId, average);
  }
  return out;
}

function groupAnswers(list: (AnswerRow & { attempt_id: string })[]): Map<string, AnswerRow[]> {
  const out = new Map<string, AnswerRow[]>();
  for (const row of list) {
    const bucket = out.get(row.attempt_id) ?? [];
    bucket.push({ question_id: row.question_id, correct: row.correct, chosen: row.chosen });
    out.set(row.attempt_id, bucket);
  }
  return out;
}

function groupQuestions(list: (QuestionRow & { exam_id: string })[]): Map<string, QuestionRow[]> {
  const out = new Map<string, QuestionRow[]>();
  for (const q of list) {
    const bucket = out.get(q.exam_id) ?? [];
    bucket.push({ id: q.id, no: q.no, points: Number(q.points), answer: q.answer, unit_code: q.unit_code });
    out.set(q.exam_id, bucket);
  }
  return out;
}

export type HistoryPoint = { attempt: AttemptRow; exam: ExamRow; score: AttemptScore };

/**
 * 한 학생의 누적. 학생 화면과 튜터의 학생 상세가 같이 쓴다.
 *
 * forStudent 는 학생이 볼 때 켠다 — '학생에게 열림' 회차에서 선생님이 다 매겨 저장한 채점만
 * 넘긴다 (scoreShown). 매기는 중인 반쪽짜리 점수와, 회차를 '준비 중' 으로 돌린 점수는 안 보인다.
 *
 * courseIds 는 튜터가 볼 때 준다 — 그 반들의 회차만 읽는다. 학생이 두 반을 들으면
 * 다른 튜터 반의 채점과 총평까지 딸려 오기 때문이다. 없으면 반을 가리지 않는다.
 */
export async function studentHistory(
  studentId: string,
  opts: { forStudent: boolean; courseIds?: readonly string[] },
): Promise<{ points: HistoryPoint[]; trends: Trends }> {
  const none = { points: [], trends: trendsOf([]) };
  const allAttempts = await rows<AttemptRow>(
    db()
      .from('lms_attempts')
      .select(ATTEMPT_COLS)
      .eq('student_id', studentId)
      .order('updated_at', { ascending: false }),
  );
  if (allAttempts.length === 0) return none;

  // 회차를 먼저 읽는다. 이 응시를 보여도 되는지는 회차가 정한다 — 어느 반인지, 열었는지.
  // 걸러진 응시의 정오는 아예 읽지 않는다.
  const examRows = await inChunks<ExamRow>([...new Set(allAttempts.map((a) => a.exam_id))], (b) =>
    db().from('lms_exams').select(EXAM_COLS).in('id', b).order('id'));
  const allowedCourses = opts.courseIds ? new Set(opts.courseIds) : null;
  const exams = new Map(
    examRows
      .filter((e) => !allowedCourses || allowedCourses.has(e.course_id))
      .filter((e) => !opts.forStudent || e.status === 'published')
      .map((e) => [e.id, e]),
  );
  const attempts = allAttempts.filter(
    (a) => exams.has(a.exam_id) && (!opts.forStudent || a.answers_source === 'tutor'),
  );
  if (attempts.length === 0) return none;

  const examIds = [...new Set(attempts.map((a) => a.exam_id))];
  const [questionRows, answerRows] = await Promise.all([
    inChunks<QuestionRow & { exam_id: string }>(examIds, (b) =>
      db().from('lms_exam_questions').select(`exam_id, ${QUESTION_COLS}`).in('exam_id', b).order('no').order('id')),
    inChunks<AnswerRow & { attempt_id: string }>(attempts.map((a) => a.id), (b) =>
      db()
        .from('lms_answers')
        .select('attempt_id, question_id, correct, chosen')
        .in('attempt_id', b)
        .order('attempt_id')
        .order('question_id')),
  ]);

  const questionsByExam = groupQuestions(questionRows);
  const answersByAttempt = groupAnswers(answerRows);

  const points = attempts
    .map((attempt) => ({
      attempt,
      exam: exams.get(attempt.exam_id)!,
      score: scoreAttempt(questionsByExam.get(attempt.exam_id) ?? [], answersByAttempt.get(attempt.id) ?? []),
    }))
    .filter((p) => !opts.forStudent || scoreShown(p.attempt, p.score))
    // 추이는 시간순으로 봐야 한다. 날짜가 없으면 만든 순서로 대신한다.
    .sort((a, b) =>
      (a.exam.exam_date ?? a.exam.created_at).localeCompare(b.exam.exam_date ?? b.exam.created_at),
    );

  // 누적 강약은 채점이 끝난 회차로만 센다. 매기다 만 회차의 정답률은 아직 모른다.
  return { points, trends: trendsOf(points.filter((p) => p.score.complete)) };
}

/**
 * 반 전체의 누적. 회차마다 examBoard 를 부르면 반 하나에 쿼리 수십 개가 나가서,
 * 필요한 것을 나눠 통째로 읽고 앱에서 접는다.
 *
 * 수학 시험지는 늘 100점 만점이지만, 평균은 여전히 `득점 / 배점합 × 100` 으로 낸다 —
 * 틀이 바뀐 회차가 섞여도 평균이 거짓말을 하지 않는다.
 */
export type CourseSummaryRow = {
  student: StudentRow;
  /** 채점이 끝난 회차 수 */
  taken: number;
  /** 100점 환산 평균. 채점된 회차가 없으면 0. */
  average: number;
  /** 가장 최근 회차의 100점 환산 점수. 없으면 null. */
  latest: number | null;
  trends: Trends;
  rank: number;
};

export async function courseSummary(courseId: string): Promise<{
  exams: ExamRow[];
  rows: CourseSummaryRow[];
  /** 칸 코드(공통 · 단원 · 배점) → 반 누적 평균 정답률 */
  partAverages: Map<string, number>;
  average: number;
}> {
  const [exams, students] = await Promise.all([listExams(courseId), listEnrolled(courseId)]);
  if (exams.length === 0 || students.length === 0) {
    return { exams, rows: students.map(emptySummaryRow), partAverages: new Map(), average: 0 };
  }

  const examIds = exams.map((e) => e.id);
  const [questionRows, attempts] = await Promise.all([
    inChunks<QuestionRow & { exam_id: string }>(examIds, (b) =>
      db().from('lms_exam_questions').select(`exam_id, ${QUESTION_COLS}`).in('exam_id', b).order('no').order('id')),
    inChunks<AttemptRow>(examIds, (b) =>
      db().from('lms_attempts').select(ATTEMPT_COLS).in('exam_id', b).order('id')),
  ]);

  /**
   * 여기가 주소줄이 가장 길어지는 자리다. 학생 스무 명이 회차 스무 번을 보면 응시가 400개고,
   * 한 번에 물으면 주소가 15KB 가 되어 414 로 튕긴다. 한 학기면 닿는 규모라 나눠 묻는다.
   */
  const answerRows = await inChunks<AnswerRow & { attempt_id: string }>(
    attempts.map((a) => a.id),
    (b) =>
      db()
        .from('lms_answers')
        .select('attempt_id, question_id, correct, chosen')
        .in('attempt_id', b)
        .order('attempt_id')
        .order('question_id'),
  );

  const questionsByExam = groupQuestions(questionRows);
  const answersByAttempt = groupAnswers(answerRows);

  // 최근 회차가 무엇인지는 시험 날짜(없으면 만든 날)로 정한다.
  const order = new Map(
    [...exams]
      .sort((a, b) => (a.exam_date ?? a.created_at).localeCompare(b.exam_date ?? b.created_at))
      .map((e, i) => [e.id, i]),
  );

  const summaryRows: CourseSummaryRow[] = students.map((student) => {
    const scored = attempts
      .filter((a) => a.student_id === student.id)
      .map((attempt) => ({
        attempt,
        score: scoreAttempt(questionsByExam.get(attempt.exam_id) ?? [], answersByAttempt.get(attempt.id) ?? []),
      }))
      // 학생에게 보이는 채점만 — 학생이 보는 평균과 여기 평균이 같아야 한다.
      .filter((s) => scoreShown(s.attempt, s.score) && s.score.total > 0)
      .sort((a, b) => (order.get(a.attempt.exam_id) ?? 0) - (order.get(b.attempt.exam_id) ?? 0));

    const scaled = scored.map((s) => (s.score.earned / s.score.total) * 100);
    return {
      student,
      taken: scored.length,
      average: scaled.length ? scaled.reduce((a, b) => a + b, 0) / scaled.length : 0,
      latest: scaled.length ? scaled[scaled.length - 1] : null,
      trends: trendsOf(scored),
      rank: 0,
    };
  });

  // 석차는 한 회차라도 채점이 끝난 학생끼리만 매긴다. 동점은 같은 등수다.
  const ranked = summaryRows.filter((r) => r.taken > 0).sort((a, b) => b.average - a.average);
  ranked.forEach((row, i) => {
    const prev = ranked[i - 1];
    row.rank = prev && Math.abs(prev.average - row.average) < 1e-9 ? prev.rank : i + 1;
  });

  // 반 누적 정답률: 학생마다 누적한 칸의 정답률을 평균 낸다. 많이 푼 학생이 평균을 끌고 가지 않게.
  const partAverages = new Map<string, number>();
  const codes = [
    ...new Set(summaryRows.flatMap((r) => [...r.trends.sections, ...r.trends.units, ...r.trends.byPoints].map((t) => t.code))),
  ];
  for (const code of codes) {
    const rates = summaryRows
      .map((r) => [...r.trends.sections, ...r.trends.units, ...r.trends.byPoints].find((t) => t.code === code))
      .filter((t): t is NonNullable<typeof t> => Boolean(t) && t!.graded > 0)
      .map((t) => t.rate);
    if (rates.length) partAverages.set(code, rates.reduce((a, b) => a + b, 0) / rates.length);
  }

  const withScores = summaryRows.filter((r) => r.taken > 0);
  return {
    exams,
    rows: summaryRows.sort(
      (a, b) => (a.rank || 999) - (b.rank || 999) || a.student.name.localeCompare(b.student.name, 'ko'),
    ),
    partAverages,
    average: withScores.length ? withScores.reduce((sum, r) => sum + r.average, 0) / withScores.length : 0,
  };
}

function emptySummaryRow(student: StudentRow): CourseSummaryRow {
  return { student, taken: 0, average: 0, latest: null, trends: trendsOf([]), rank: 0 };
}
