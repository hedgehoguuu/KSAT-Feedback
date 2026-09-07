import 'server-only';
import { AREAS, isAreaCode, layoutAreaFor, type Elective, type PublishStatus } from '@/config/lms';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  areaTrends,
  courseStats,
  scoreAttempt,
  type AnswerRow,
  type AttemptScore,
  type CourseStats,
  type QuestionRow,
} from './score';
import { listEnrolled } from './courses';
import { getStudent, type StudentRow } from './users';

function db() {
  const client = supabaseAdmin();
  if (!client) throw new Error('LMS_DB_MISSING');
  return client;
}

export type ExamRow = {
  id: string;
  course_id: string;
  title: string;
  exam_date: string | null;
  status: PublishStatus;
  created_at: string;
};

export type AttemptRow = {
  id: string;
  exam_id: string;
  student_id: string;
  elective: Elective | null;
  overall_comment: string | null;
  status: PublishStatus;
  updated_at: string;
};

const EXAM_COLS = 'id, course_id, title, exam_date, status, created_at';
const QUESTION_COLS = 'id, no, area_code, points, answer, passage';
const ATTEMPT_COLS = 'id, exam_id, student_id, elective, overall_comment, status, updated_at';

/* ─────────────────────────────────────────────────────────── 시험 회차 */

export async function listExams(courseId: string): Promise<ExamRow[]> {
  const { data } = await db()
    .from('lms_exams')
    .select(EXAM_COLS)
    .eq('course_id', courseId)
    // 날짜를 안 적은 회차가 맨 아래로 가지 않도록 만든 순서를 보조로 쓴다.
    .order('exam_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  return (data ?? []) as ExamRow[];
}

export async function getExam(id: string): Promise<ExamRow | null> {
  const { data } = await db().from('lms_exams').select(EXAM_COLS).eq('id', id).maybeSingle();
  return (data as ExamRow) ?? null;
}

export async function saveExam(input: {
  id?: string;
  course_id: string;
  title: string;
  exam_date: string | null;
  status: PublishStatus;
}): Promise<string> {
  const row = { title: input.title.trim(), exam_date: input.exam_date, status: input.status };

  if (input.id) {
    await db().from('lms_exams').update(row).eq('id', input.id);
    return input.id;
  }

  const { data, error } = await db()
    .from('lms_exams')
    .insert({ ...row, course_id: input.course_id })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('LMS_CREATE_EXAM_FAILED');
  return data.id;
}

export async function deleteExam(id: string): Promise<void> {
  await db().from('lms_exams').delete().eq('id', id);
}

/* ─────────────────────────────────────────────────────────── 문항표 */

export async function listQuestions(examId: string): Promise<QuestionRow[]> {
  const { data } = await db().from('lms_exam_questions').select(QUESTION_COLS).eq('exam_id', examId).order('no');
  return ((data ?? []) as QuestionRow[]).map((q) => ({ ...q, points: Number(q.points) }));
}

export type QuestionInput = {
  no: number;
  area_code: string;
  points: number;
  answer: number | null;
  passage: string | null;
};

/**
 * 문항 하나를 가리키는 열쇠.
 *
 * 번호만으로는 모자란다 — 국어 35~45번은 화작 학생과 언매 학생이 **같은 번호로 서로 다른
 * 문항**을 푼다. 두 벌이 한 회차에 함께 있어야 하므로 번호와 영역을 같이 봐야 한 문항이다.
 */
function questionKey(q: { no: number; area_code: string }): string {
  return `${q.no}|${q.area_code}`;
}

/**
 * 문항표를 통째로 갈아 끼운다.
 *
 * 한 줄씩 고치지 않는 이유: 문항 번호가 밀리거나 영역이 통째로 바뀌는 일이 잦은데,
 * 그때 어떤 줄이 어떤 줄로 바뀐 것인지 짝을 맞추려면 화면에서 그 정보를 들고 다녀야 한다.
 *
 * 대신 이미 매긴 정오를 잃지 않도록 **번호와 영역을 열쇠로 삼아** 살릴 수 있는 것은 살린다.
 * 둘 다 그대로면 그 문항의 O/X 는 그대로 남고, 사라진 것의 정오만 지워진다.
 * 영역을 고치면 그 문항의 O/X 는 사라진다 — 다른 문항이 된 것으로 본다.
 */
export async function replaceQuestions(examId: string, rows: QuestionInput[]): Promise<void> {
  const clean = rows
    .filter((r) => Number.isInteger(r.no) && r.no >= 1 && isAreaCode(r.area_code))
    .sort((a, b) => a.no - b.no || a.area_code.localeCompare(b.area_code));

  const before = await listQuestions(examId);
  const idByKey = new Map(before.map((q) => [questionKey(q), q.id]));
  const keep = new Set(clean.map(questionKey));

  // 없어진 것부터 지운다. 그 문항에 달린 정오도 함께 사라진다(cascade).
  const goneIds = before.filter((q) => !keep.has(questionKey(q))).map((q) => q.id);
  if (goneIds.length) await db().from('lms_exam_questions').delete().in('id', goneIds);

  const updates = clean.filter((r) => idByKey.has(questionKey(r)));
  const inserts = clean.filter((r) => !idByKey.has(questionKey(r)));

  for (const r of updates) {
    await db()
      .from('lms_exam_questions')
      .update({ points: r.points, answer: r.answer, passage: r.passage })
      .eq('id', idByKey.get(questionKey(r))!);
  }

  if (inserts.length) {
    await db()
      .from('lms_exam_questions')
      .insert(inserts.map((r) => ({ ...r, exam_id: examId })));
  }
}

/**
 * 새 회차의 기본 문항표. 빈 표를 주면 45줄을 손으로 다 채워야 해서,
 * 국어 시험지의 통상 배치(1–17 독서 · 18–34 문학 · 35– 선택)를 미리 깔아 준다.
 * 회차마다 다르므로 그대로 쓰라는 뜻은 아니고, 고칠 거리를 줄이려는 것이다.
 *
 * 선택과목 구간은 **고른 과목마다 한 벌씩** 깐다. 한 반에 화작 학생과 언매 학생이
 * 섞여 있는 것이 보통이고, 두 벌이 다 있어야 둘 다 채점된다.
 * 같은 번호에 두 줄이 생기는데 그게 맞다 — 35번은 두 학생에게 서로 다른 문항이다.
 */
export function defaultQuestionRows(
  count: number,
  electives: readonly Elective[] = ['speech', 'media'],
): QuestionInput[] {
  const rows: QuestionInput[] = [];
  const chosen = electives.length > 0 ? electives : (['speech'] as const);

  for (let no = 1; no <= count; no += 1) {
    const area = layoutAreaFor(no);
    if (area) {
      rows.push(row(no, area));
      continue;
    }
    // 배치표에 없는 뒷번호는 선택과목 구간이다. 고른 과목마다 한 줄씩.
    for (const e of chosen) {
      const found = AREAS.find((a) => a.elective === e);
      if (found) rows.push(row(no, found.code));
    }
  }
  return rows;
}

function row(no: number, area_code: string): QuestionInput {
  return { no, area_code, points: 2, answer: null, passage: null };
}

/* ─────────────────────────────────────────────────────────── 응시 */

export async function listAttempts(examId: string): Promise<AttemptRow[]> {
  const { data } = await db().from('lms_attempts').select(ATTEMPT_COLS).eq('exam_id', examId);
  return (data ?? []) as AttemptRow[];
}

export async function getAttempt(id: string): Promise<AttemptRow | null> {
  const { data } = await db().from('lms_attempts').select(ATTEMPT_COLS).eq('id', id).maybeSingle();
  return (data as AttemptRow) ?? null;
}

/**
 * 이 학생의 이 회차 응시를 가져오거나 만든다.
 *
 * 만들 때 학생의 선택과목을 베껴 둔다. 나중에 학생이 화작에서 언매로 바꿔도
 * 지난 회차의 채점 결과가 뒤늦게 달라지지 않게 하려는 것이다.
 */
export async function openAttempt(examId: string, studentId: string): Promise<AttemptRow> {
  const { data: found } = await db()
    .from('lms_attempts')
    .select(ATTEMPT_COLS)
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (found) return found as AttemptRow;

  const student = await getStudent(studentId);
  const { data, error } = await db()
    .from('lms_attempts')
    .insert({ exam_id: examId, student_id: studentId, elective: student?.profile?.elective ?? null })
    .select(ATTEMPT_COLS)
    .single();

  // 두 사람이 같은 학생을 동시에 열면 unique 에 걸린다. 그때는 먼저 만들어진 것을 쓴다.
  if (error?.code === '23505') {
    const { data: raced } = await db()
      .from('lms_attempts')
      .select(ATTEMPT_COLS)
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .single();
    return raced as AttemptRow;
  }
  if (error || !data) throw error ?? new Error('LMS_OPEN_ATTEMPT_FAILED');
  return data as AttemptRow;
}

export async function listAnswers(attemptId: string): Promise<AnswerRow[]> {
  const { data } = await db()
    .from('lms_answers')
    .select('question_id, correct, chosen')
    .eq('attempt_id', attemptId);
  return (data ?? []) as AnswerRow[];
}

export async function listAreaComments(attemptId: string): Promise<Map<string, string>> {
  const { data } = await db().from('lms_area_comments').select('area_code, comment').eq('attempt_id', attemptId);
  return new Map(((data ?? []) as { area_code: string; comment: string }[]).map((r) => [r.area_code, r.comment]));
}

/**
 * 채점 한 판을 통째로 저장한다.
 *
 * 정오는 지우고 다시 넣는다. 한 문항씩 맞춰 넣으면 '아까는 O 였는데 지금은 안 매김'
 * 상태를 지우는 것을 빠뜨리기 쉽다 — 그러면 지운 표시가 화면에만 사라지고 DB 에 남는다.
 */
export async function saveGrading(input: {
  attemptId: string;
  elective: Elective | null;
  answers: { question_id: string; correct: boolean; chosen: number | null }[];
  areaComments: { area_code: string; comment: string }[];
  overallComment: string | null;
  status: PublishStatus;
}): Promise<void> {
  await db().from('lms_answers').delete().eq('attempt_id', input.attemptId);
  if (input.answers.length) {
    await db()
      .from('lms_answers')
      .insert(input.answers.map((a) => ({ ...a, attempt_id: input.attemptId })));
  }

  await db().from('lms_area_comments').delete().eq('attempt_id', input.attemptId);
  const comments = input.areaComments.filter((c) => c.comment.trim().length > 0);
  if (comments.length) {
    await db()
      .from('lms_area_comments')
      .insert(comments.map((c) => ({ ...c, comment: c.comment.trim(), attempt_id: input.attemptId })));
  }

  await db()
    .from('lms_attempts')
    .update({
      elective: input.elective,
      overall_comment: input.overallComment,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.attemptId);
}

/**
 * 채점이 끝난 응시를 한 번에 공개한다.
 *
 * 학생이 열둘이면 채점 화면을 열두 번 들어가 공개를 눌러야 했다. 그건 일이 아니라 노동이다.
 *
 * **채점이 끝난 것만** 공개한다. 매기다 만 응시가 섞여 들어가면 학생이 반쪽짜리 점수를
 * 보게 되는데, 그게 이 화면에서 가장 나쁜 일이다. 몇 명이 공개됐고 몇 명이 남았는지 돌려준다.
 */
export async function publishGradedAttempts(
  exam: ExamRow,
): Promise<{ published: number; skipped: number }> {
  const board = await examBoard(exam);

  const ready = board.rows
    .filter((r) => r.attempt && r.score.complete && r.attempt.status !== 'published')
    .map((r) => r.attempt!.id);
  const skipped = board.rows.filter((r) => !r.attempt || !r.score.complete).length;

  if (ready.length > 0) {
    await db()
      .from('lms_attempts')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .in('id', ready);
  }

  return { published: ready.length, skipped };
}

/**
 * 다른 회차의 문항표를 그대로 가져온다.
 *
 * 같은 형식의 실전 모의고사를 매주 보면 배점과 영역 배치가 거의 그대로다. 매번 45줄을
 * 새로 만드는 대신 지난 회차를 베끼고 다른 데만 고치는 편이 빠르다.
 *
 * 정답은 가져오지 않는다 — 회차마다 반드시 다르고, 지난 회차 정답이 남아 있으면
 * 고치는 걸 잊었을 때 조용히 틀린 채점이 된다. 비워서 오면 최소한 빈 게 보인다.
 */
export async function copyQuestionTable(fromExamId: string, toExamId: string): Promise<number> {
  const source = await listQuestions(fromExamId);
  if (source.length === 0) return 0;

  await replaceQuestions(
    toExamId,
    source.map((q) => ({
      no: q.no,
      area_code: q.area_code,
      points: q.points,
      answer: null,
      passage: q.passage,
    })),
  );
  return source.length;
}

/* ────────────────────────────────────────────────── 화면이 통째로 쓰는 것 */

export type GradedAttempt = {
  attempt: AttemptRow;
  student: StudentRow;
  score: AttemptScore;
  answers: AnswerRow[];
  areaComments: Map<string, string>;
};

/** 채점 화면 한 장에 필요한 것 전부. */
export async function loadGrading(attemptId: string): Promise<
  | (GradedAttempt & { exam: ExamRow; questions: QuestionRow[] })
  | null
> {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return null;

  const [exam, student, questions, answers, areaComments] = await Promise.all([
    getExam(attempt.exam_id),
    getStudent(attempt.student_id),
    listQuestions(attempt.exam_id),
    listAnswers(attemptId),
    listAreaComments(attemptId),
  ]);
  if (!exam || !student) return null;

  return {
    attempt,
    exam,
    student,
    questions,
    answers,
    areaComments,
    score: scoreAttempt(questions, answers, attempt.elective),
  };
}

/**
 * 한 회차의 반 전체. 아직 응시 행이 없는 학생도 빈 성적으로 넣는다 —
 * 명단에서 빠지면 누구를 아직 안 매겼는지 알 수 없다.
 */
export async function examBoard(exam: ExamRow): Promise<{
  questions: QuestionRow[];
  rows: { student: StudentRow; attempt: AttemptRow | null; score: AttemptScore }[];
  stats: CourseStats;
}> {
  const [questions, students, attempts] = await Promise.all([
    listQuestions(exam.id),
    listEnrolled(exam.course_id),
    listAttempts(exam.id),
  ]);

  const byStudent = new Map(attempts.map((a) => [a.student_id, a]));
  const answerRows = attempts.length
    ? ((
        await db()
          .from('lms_answers')
          .select('attempt_id, question_id, correct, chosen')
          .in('attempt_id', attempts.map((a) => a.id))
      ).data ?? [])
    : [];

  const answersByAttempt = new Map<string, AnswerRow[]>();
  for (const row of answerRows as (AnswerRow & { attempt_id: string })[]) {
    const list = answersByAttempt.get(row.attempt_id) ?? [];
    list.push({ question_id: row.question_id, correct: row.correct, chosen: row.chosen });
    answersByAttempt.set(row.attempt_id, list);
  }

  const rows = students.map((student) => {
    const attempt = byStudent.get(student.id) ?? null;
    const elective = attempt?.elective ?? student.profile?.elective ?? null;
    const score = scoreAttempt(questions, attempt ? (answersByAttempt.get(attempt.id) ?? []) : [], elective);
    return { student, attempt, score };
  });

  return {
    questions,
    rows,
    stats: courseStats(rows.map((r) => ({ studentId: r.student.id, name: r.student.name, score: r.score }))),
  };
}

/**
 * 한 학생의 누적. 학생 화면과 튜터의 학생 상세가 같이 쓴다.
 * publishedOnly 는 학생이 볼 때 켠다 — 채점 중인 회차가 학생에게 보이면 안 된다.
 */
export async function studentHistory(
  studentId: string,
  opts: { publishedOnly: boolean },
): Promise<{
  points: {
    attempt: AttemptRow;
    exam: ExamRow;
    score: AttemptScore;
    areaComments: Map<string, string>;
  }[];
  trends: ReturnType<typeof areaTrends>;
}> {
  const { data } = await db()
    .from('lms_attempts')
    .select(ATTEMPT_COLS)
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false });

  let attempts = (data ?? []) as AttemptRow[];
  if (opts.publishedOnly) attempts = attempts.filter((a) => a.status === 'published');
  if (attempts.length === 0) return { points: [], trends: [] };

  const examIds = [...new Set(attempts.map((a) => a.exam_id))];
  const [{ data: examRows }, { data: questionRows }, { data: answerRows }, { data: commentRows }] =
    await Promise.all([
      db().from('lms_exams').select(EXAM_COLS).in('id', examIds),
      db().from('lms_exam_questions').select(`exam_id, ${QUESTION_COLS}`).in('exam_id', examIds),
      db()
        .from('lms_answers')
        .select('attempt_id, question_id, correct, chosen')
        .in('attempt_id', attempts.map((a) => a.id)),
      db()
        .from('lms_area_comments')
        .select('attempt_id, area_code, comment')
        .in('attempt_id', attempts.map((a) => a.id)),
    ]);

  const exams = new Map(((examRows ?? []) as ExamRow[]).map((e) => [e.id, e]));

  const questionsByExam = new Map<string, QuestionRow[]>();
  for (const q of (questionRows ?? []) as (QuestionRow & { exam_id: string })[]) {
    const list = questionsByExam.get(q.exam_id) ?? [];
    list.push({ ...q, points: Number(q.points) });
    questionsByExam.set(q.exam_id, list);
  }

  const answersByAttempt = new Map<string, AnswerRow[]>();
  for (const a of (answerRows ?? []) as (AnswerRow & { attempt_id: string })[]) {
    const list = answersByAttempt.get(a.attempt_id) ?? [];
    list.push({ question_id: a.question_id, correct: a.correct, chosen: a.chosen });
    answersByAttempt.set(a.attempt_id, list);
  }

  const commentsByAttempt = new Map<string, Map<string, string>>();
  for (const c of (commentRows ?? []) as { attempt_id: string; area_code: string; comment: string }[]) {
    const map = commentsByAttempt.get(c.attempt_id) ?? new Map<string, string>();
    map.set(c.area_code, c.comment);
    commentsByAttempt.set(c.attempt_id, map);
  }

  const points = attempts
    .map((attempt) => {
      const exam = exams.get(attempt.exam_id);
      if (!exam) return null;
      return {
        attempt,
        exam,
        score: scoreAttempt(
          questionsByExam.get(attempt.exam_id) ?? [],
          answersByAttempt.get(attempt.id) ?? [],
          attempt.elective,
        ),
        areaComments: commentsByAttempt.get(attempt.id) ?? new Map<string, string>(),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    // 추이는 시간순으로 봐야 한다. 날짜가 없으면 만든 순서로 대신한다.
    .sort((a, b) =>
      (a.exam.exam_date ?? a.exam.created_at).localeCompare(b.exam.exam_date ?? b.exam.created_at),
    );

  return { points, trends: areaTrends(points) };
}

/**
 * 반 전체의 누적. 회차마다 examBoard 를 부르면 반 하나에 쿼리 수십 개가 나가서,
 * 필요한 것을 네 번에 나눠 통째로 읽고 앱에서 접는다.
 *
 * 회차마다 만점이 다르므로(문항 수·배점이 다르다) 평균은 원점수가 아니라 100점 환산으로 낸다.
 * 원점수 평균은 쉬운 회차가 많았던 학생을 잘한 학생으로 만든다.
 */
export type CourseSummaryRow = {
  student: StudentRow;
  /** 채점이 끝난 회차 수 */
  taken: number;
  /** 100점 환산 평균. 채점된 회차가 없으면 0. */
  average: number;
  /** 가장 최근 회차의 100점 환산 점수. 없으면 null. */
  latest: number | null;
  areas: ReturnType<typeof areaTrends>;
  rank: number;
};

export async function courseSummary(courseId: string): Promise<{
  exams: ExamRow[];
  rows: CourseSummaryRow[];
  /** 영역 코드 → 반 누적 평균 정답률 */
  areaAverages: Map<string, number>;
  average: number;
}> {
  const [exams, students] = await Promise.all([listExams(courseId), listEnrolled(courseId)]);
  if (exams.length === 0 || students.length === 0) {
    return { exams, rows: students.map(emptySummaryRow), areaAverages: new Map(), average: 0 };
  }

  const examIds = exams.map((e) => e.id);
  const [{ data: questionRows }, { data: attemptRows }] = await Promise.all([
    db().from('lms_exam_questions').select(`exam_id, ${QUESTION_COLS}`).in('exam_id', examIds),
    db().from('lms_attempts').select(ATTEMPT_COLS).in('exam_id', examIds),
  ]);

  const attempts = (attemptRows ?? []) as AttemptRow[];
  const { data: answerRows } = attempts.length
    ? await db()
        .from('lms_answers')
        .select('attempt_id, question_id, correct, chosen')
        .in('attempt_id', attempts.map((a) => a.id))
    : { data: [] };

  const questionsByExam = new Map<string, QuestionRow[]>();
  for (const q of (questionRows ?? []) as (QuestionRow & { exam_id: string })[]) {
    const list = questionsByExam.get(q.exam_id) ?? [];
    list.push({ ...q, points: Number(q.points) });
    questionsByExam.set(q.exam_id, list);
  }

  const answersByAttempt = new Map<string, AnswerRow[]>();
  for (const a of (answerRows ?? []) as (AnswerRow & { attempt_id: string })[]) {
    const list = answersByAttempt.get(a.attempt_id) ?? [];
    list.push({ question_id: a.question_id, correct: a.correct, chosen: a.chosen });
    answersByAttempt.set(a.attempt_id, list);
  }

  // 최근 회차가 무엇인지는 시험 날짜(없으면 만든 날)로 정한다.
  const order = new Map(
    [...exams]
      .sort((a, b) => (a.exam_date ?? a.created_at).localeCompare(b.exam_date ?? b.created_at))
      .map((e, i) => [e.id, i]),
  );

  const rows: CourseSummaryRow[] = students.map((student) => {
    const mine = attempts.filter((a) => a.student_id === student.id);
    const scored = mine
      .map((attempt) => ({
        attempt,
        score: scoreAttempt(
          questionsByExam.get(attempt.exam_id) ?? [],
          answersByAttempt.get(attempt.id) ?? [],
          attempt.elective,
        ),
      }))
      .filter((s) => s.score.complete && s.score.total > 0)
      .sort((a, b) => (order.get(a.attempt.exam_id) ?? 0) - (order.get(b.attempt.exam_id) ?? 0));

    const scaled = scored.map((s) => (s.score.earned / s.score.total) * 100);
    return {
      student,
      taken: scored.length,
      average: scaled.length ? scaled.reduce((a, b) => a + b, 0) / scaled.length : 0,
      latest: scaled.length ? scaled[scaled.length - 1] : null,
      areas: areaTrends(scored),
      rank: 0,
    };
  });

  // 석차는 한 회차라도 채점이 끝난 학생끼리만 매긴다. 동점은 같은 등수다.
  const ranked = rows.filter((r) => r.taken > 0).sort((a, b) => b.average - a.average);
  ranked.forEach((row, i) => {
    const prev = ranked[i - 1];
    row.rank = prev && Math.abs(prev.average - row.average) < 1e-9 ? prev.rank : i + 1;
  });

  const areaAverages = new Map<string, number>();
  for (const area of AREAS) {
    const rates = rows
      .map((r) => r.areas.find((a) => a.code === area.code))
      .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.graded > 0)
      .map((a) => a.rate);
    if (rates.length) areaAverages.set(area.code, rates.reduce((a, b) => a + b, 0) / rates.length);
  }

  const withScores = rows.filter((r) => r.taken > 0);
  return {
    exams,
    rows: rows.sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.student.name.localeCompare(b.student.name, 'ko')),
    areaAverages,
    average: withScores.length
      ? withScores.reduce((sum, r) => sum + r.average, 0) / withScores.length
      : 0,
  };
}

function emptySummaryRow(student: StudentRow): CourseSummaryRow {
  return { student, taken: 0, average: 0, latest: null, areas: [], rank: 0 };
}
