import 'server-only';
import { CONCERN, LMS, concernOrder, isConcernTopic, unitLabel } from '@/config/lms';
import { seoulDate } from '@/lib/kst';
import { mailConfigured } from '@/lib/worker/mail';
import { coursesOfStudent, getCourse, type CourseRow } from './courses';
import { db, inChunks, must, one, rows } from './db';
import {
  ATTEMPT_COLS,
  loadGrading,
  submissionCounts,
  type AttemptRow,
  type ExamRow,
  type SubmissionCount,
} from './exams';
import { getFile, paths, putFile, removeFiles, removeFilesQuietly } from './files';
import { sendFeedbackMail } from './mail';
import { renderFeedbackPdf, type FeedbackDoc } from './pdf/feedback-pdf';
import { loadFonts } from './pdf/fonts';
import type { AnswerRow } from './score';
import { getUser, type StudentRow, type UserRow } from './users';

/**
 * 시험 뒤의 질문과 답.
 *
 *   학생   시험지 사진을 올리고, 문항마다 고민을 적어 '제출' 한다.
 *   튜터   다음 수업 전까지 질문마다 답을 단다 (글, 또는 손으로 쓴 풀이 사진).
 *   보내기 답이 다 달렸는지 DB 가 한 번 더 확인하면, 답변 PDF 를 만들어 저장하고
 *          학생 메일로 보낸다. 그때부터 학생 화면에서도 받을 수 있고 학생 쪽은 잠긴다.
 *
 * '다 단 것' 의 확인은 화면과 DB 두 군데서 한다 (0015 mark_feedback_ready). 화면에서만
 * 보면, 튜터가 보내기를 누르는 사이 학생이 올린 질문 하나가 답 없이 잠겨 버린다.
 */

export type PhotoRow = {
  id: string;
  attempt_id: string;
  storage_path: string;
  order_index: number;
  bytes: number | null;
  created_at: string;
};

export type ConcernRow = {
  id: string;
  attempt_id: string;
  /** 0 = 시험 전체 */
  question_no: number;
  body: string;
  answer: string | null;
  answer_image_path: string | null;
  /** 튜터 답이 마지막으로 바뀐 시각 */
  answered_at: string | null;
  created_at: string;
  /** 학생이 질문을 마지막으로 고친 시각. 튜터 답으로는 안 바뀐다. */
  updated_at: string;
};

const PHOTO_COLS = 'id, attempt_id, storage_path, order_index, bytes, created_at';
const CONCERN_COLS =
  'id, attempt_id, question_no, body, answer, answer_image_path, answered_at, created_at, updated_at';

/** 글이든 사진이든 답이 있으면 단 것이다. */
export function isAnswered(c: Pick<ConcernRow, 'answer' | 'answer_image_path'>): boolean {
  return Boolean(c.answer?.trim()) || Boolean(c.answer_image_path);
}

export type Progress = { total: number; answered: number; missing: number[] };

export function progressOf(concerns: Pick<ConcernRow, 'question_no' | 'answer' | 'answer_image_path'>[]): Progress {
  const missing = concerns.filter((c) => !isAnswered(c)).map((c) => c.question_no);
  return { total: concerns.length, answered: concerns.length - missing.length, missing };
}

/* ───────────────────────────────────────────────────────────── 시험지 사진 */

export async function listPhotos(attemptId: string): Promise<PhotoRow[]> {
  return await rows<PhotoRow>(
    db()
      .from('lms_attempt_photos')
      .select(PHOTO_COLS)
      .eq('attempt_id', attemptId)
      .order('order_index')
      .order('created_at'),
  );
}

/**
 * 사진 한 장을 올린다. 파일을 먼저 올리고 줄을 만든다 — 줄을 못 만들면 파일을 도로 지운다.
 * 그러지 않으면 어디에도 안 보이는 시험지 사진이 저장소에 남는다.
 *
 * 줄이 생기는 순간 DB 가 사진으로 매긴 채점을 비운다 (0016 트리거). 새 사진까지 읽은 결과로
 * 다시 채우는 것은 사진 읽기(photo-read.ts)의 몫이다.
 */
export async function addPhoto(attemptId: string, bytes: Uint8Array): Promise<PhotoRow | 'TOO_MANY'> {
  const existing = await listPhotos(attemptId);
  if (existing.length >= LMS.maxPhotos) return 'TOO_MANY';

  const path = paths.photo(attemptId);
  await putFile(path, bytes, 'image/jpeg');
  try {
    const next = existing.reduce((max, p) => Math.max(max, p.order_index), -1) + 1;
    const { data, error } = await db()
      .from('lms_attempt_photos')
      .insert({ attempt_id: attemptId, storage_path: path, order_index: next, bytes: bytes.byteLength })
      .select(PHOTO_COLS)
      .single();
    if (error || !data) throw error ?? new Error('LMS_PHOTO_INSERT_FAILED');
    return data as unknown as PhotoRow;
  } catch (error) {
    await removeFilesQuietly([path]);
    throw error;
  }
}

/**
 * 사진을 지운다. 이 응시의 사진이 아니면 아무것도 안 한다. 파일을 먼저 지운다.
 * 줄이 지워지는 순간 DB 가 사진으로 매긴 채점을 비운다 (0016 트리거).
 */
export async function removePhoto(attemptId: string, photoId: string): Promise<boolean> {
  const photo = await one<PhotoRow>(
    db().from('lms_attempt_photos').select(PHOTO_COLS).eq('id', photoId).eq('attempt_id', attemptId).maybeSingle(),
  );
  if (!photo) return false;

  await removeFiles([photo.storage_path]);
  await must(db().from('lms_attempt_photos').delete().eq('id', photo.id));
  return true;
}

/** 한 칸 앞뒤로. 번호가 겹쳐 있을 수 있어서 옮긴 김에 0 부터 다시 매긴다. */
export async function movePhoto(attemptId: string, photoId: string, step: -1 | 1): Promise<void> {
  const list = await listPhotos(attemptId);
  const from = list.findIndex((p) => p.id === photoId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return;

  [list[from], list[to]] = [list[to], list[from]];
  for (const [index, photo] of list.entries()) {
    if (photo.order_index !== index) {
      await must(db().from('lms_attempt_photos').update({ order_index: index }).eq('id', photo.id));
    }
  }
}

/* ───────────────────────────────────────────────────────────── 학생 질문 */

export async function listConcerns(attemptId: string): Promise<ConcernRow[]> {
  const found = await rows<ConcernRow>(
    db().from('lms_concerns').select(CONCERN_COLS).eq('attempt_id', attemptId).order('question_no'),
  );
  return found.sort((a, b) => concernOrder(a.question_no, b.question_no));
}

export type ConcernDraft = { question_no: number; body: string };

/**
 * 폼에서 온 질문을 거른다. 버리지 않고 이유를 돌려준다 — 적어 둔 질문이 말없이 사라지면
 * 학생은 보냈다고 믿고 답을 기다린다.
 *
 * 같은 문항이 두 번 오면 한 질문으로 합친다(한 문항에 한 줄이다). 빈 칸은 그냥 빈 칸이다.
 */
export function cleanConcerns(input: { question_no: number; body: string }[]): {
  drafts: ConcernDraft[];
  problem: string | null;
} {
  const merged = new Map<number, string[]>();
  for (const item of input) {
    const body = item.body.replace(/\r\n?/g, '\n').trim();
    if (!body) continue;
    if (!isConcernTopic(item.question_no)) return { drafts: [], problem: 'NO' };
    merged.set(item.question_no, [...(merged.get(item.question_no) ?? []), body]);
  }

  const drafts = [...merged].map(([question_no, bodies]) => ({ question_no, body: bodies.join('\n\n') }));
  // DB 는 글자 수(code point)로 센다. JS 의 length 는 이모지를 두 칸으로 세므로 맞춰 센다.
  if (drafts.some((d) => Array.from(d.body).length > CONCERN.maxBody)) return { drafts: [], problem: 'LONG' };
  return { drafts: drafts.sort((a, b) => concernOrder(a.question_no, b.question_no)), problem: null };
}

/**
 * 학생 질문을 통째로 맞춘다 (0015 save_concerns). 답이 달린 질문은 DB 가 지켜 준다.
 * 답 PDF 가 이미 나갔으면 'LOCKED'.
 */
export async function saveConcerns(
  attemptId: string,
  drafts: ConcernDraft[],
  submit: boolean,
): Promise<'OK' | 'LOCKED'> {
  const { error } = await db().rpc('save_concerns', {
    payload: { attempt_id: attemptId, submit, concerns: drafts },
  });
  if (error?.code === 'P0001' && error.message === 'FEEDBACK_SENT') return 'LOCKED';
  if (error) throw error;
  return 'OK';
}

/* ───────────────────────────────────────────────────────────── 튜터 답 */

/** 여러 질문의 답을 한 번에 저장한다 (0015 save_concern_answers). 답이 달린 질문 수를 돌려준다. */
export async function saveConcernAnswers(
  attemptId: string,
  answers: { id: string; answer: string }[],
): Promise<number> {
  const { data, error } = await db().rpc('save_concern_answers', {
    payload: { attempt_id: attemptId, answers },
  });
  if (error) throw error;
  return Number(data ?? 0);
}

async function concernOf(attemptId: string, concernId: string): Promise<ConcernRow | null> {
  return await one<ConcernRow>(
    db().from('lms_concerns').select(CONCERN_COLS).eq('id', concernId).eq('attempt_id', attemptId).maybeSingle(),
  );
}

/**
 * 손으로 쓴 풀이 사진을 붙인다. 이미 있으면 바꾼다.
 * 새 파일을 올리고 → 줄을 고치고 → 옛 파일을 지운다. 줄을 못 고치면 새 파일을 도로 지운다.
 */
export async function setAnswerImage(
  attemptId: string,
  concernId: string,
  bytes: Uint8Array,
): Promise<'OK' | 'NOT_FOUND'> {
  const concern = await concernOf(attemptId, concernId);
  if (!concern) return 'NOT_FOUND';

  const path = paths.answerImage(attemptId, concernId);
  await putFile(path, bytes, 'image/jpeg');
  try {
    // updated_at 은 '학생이 질문을 고친 시각' 이라 여기서 건드리지 않는다.
    await must(
      db()
        .from('lms_concerns')
        .update({ answer_image_path: path, answered_at: new Date().toISOString() })
        .eq('id', concern.id),
    );
  } catch (error) {
    await removeFilesQuietly([path]);
    throw error;
  }

  await removeFilesQuietly([concern.answer_image_path]);
  return 'OK';
}

/**
 * 풀이 사진을 뗀다. 줄을 먼저 고치고 파일을 지운다 — 파일이 남는 것은 튜터 필기 한 장이지만,
 * 줄이 없는 파일을 가리키면 답변 화면과 PDF 에 깨진 사진이 뜬다.
 */
export async function clearAnswerImage(attemptId: string, concernId: string): Promise<void> {
  const concern = await concernOf(attemptId, concernId);
  if (!concern?.answer_image_path) return;

  await must(
    db()
      .from('lms_concerns')
      .update({
        answer_image_path: null,
        answered_at: concern.answer ? concern.answered_at : null,
      })
      .eq('id', concern.id),
  );
  await removeFilesQuietly([concern.answer_image_path]);
}

/* ───────────────────────────────────────────────────────────── 답변 PDF */

export type BuiltFeedback = {
  doc: FeedbackDoc;
  attempt: AttemptRow;
  /** PDF 를 만들 때 읽은 정오. 보낼 때 DB 가 지금 정오와 견준다 (0016 mark_feedback_ready). */
  answers: AnswerRow[];
  exam: ExamRow;
  course: CourseRow;
  student: StudentRow;
  tutor: UserRow | null;
  concerns: ConcernRow[];
  /** 채점이 끝나 점수가 PDF 에 들어갔는가 */
  scored: boolean;
};

/** PDF 한 권에 들어갈 것을 모은다. 미리 보기와 보내기가 같은 것을 쓴다. */
export async function buildFeedback(attemptId: string): Promise<BuiltFeedback | null> {
  const grading = await loadGrading(attemptId);
  if (!grading) return null;
  const { attempt, exam, student, questions, answers, score } = grading;

  const [course, concerns] = await Promise.all([getCourse(exam.course_id), listConcerns(attemptId)]);
  if (!course) return null;
  const tutor = course.tutor_id ? await getUser(course.tutor_id) : null;

  const byNo = new Map(questions.map((q) => [q.no, q]));
  const marks = new Map(answers.map((a) => [a.question_id, a]));
  const markOf = (no: number): 'o' | 'x' | null => {
    const q = byNo.get(no);
    const a = q ? marks.get(q.id) : undefined;
    return a ? (a.correct ? 'o' : 'x') : null;
  };

  const images = await Promise.all(
    concerns.map(async (c) => {
      if (!c.answer_image_path) return null;
      const type = c.answer_image_path.endsWith('.png') ? ('png' as const) : ('jpg' as const);
      try {
        return { bytes: await getFile(c.answer_image_path), type };
      } catch (error) {
        console.error('[lms] 풀이 사진을 못 받았어요', c.answer_image_path, error);
        // 빈 바이트로 넘기면 PDF 가 그 자리에 '사진을 싣지 못했어요' 라고 적는다.
        return { bytes: new Uint8Array(0), type };
      }
    }),
  );

  const scored = score.complete;
  const doc: FeedbackDoc = {
    courseName: course.name,
    examTitle: exam.title,
    examDate: exam.exam_date,
    studentName: student.name,
    tutorName: tutor?.name ?? null,
    issuedOn: seoulDate(),
    score: scored
      ? {
          earned: score.earned,
          total: score.total,
          sections: score.sections.map((s) => ({ label: s.label, earned: s.earned, total: s.total })),
          wrongNos: score.wrongNos,
          grid: questions.map((q) => ({
            no: q.no,
            answer: q.answer,
            chosen: marks.get(q.id)?.chosen ?? null,
            mark: markOf(q.no),
          })),
        }
      : null,
    concerns: concerns.map((c, i) => {
      const unit = c.question_no ? byNo.get(c.question_no)?.unit_code : null;
      return {
        no: c.question_no,
        body: c.body,
        answer: c.answer,
        image: images[i],
        mark: c.question_no ? markOf(c.question_no) : null,
        unitLabel: unit ? unitLabel(unit) : null,
      };
    }),
    overallComment: attempt.overall_comment,
  };

  return { doc, attempt, answers, exam, course, student, tutor, concerns, scored };
}

export async function renderFeedback(built: BuiltFeedback): Promise<Uint8Array> {
  return renderFeedbackPdf(built.doc, await loadFonts());
}

export type MailOutcome =
  | { status: 'SENT'; to: string }
  | { status: 'NO_EMAIL' }
  | { status: 'NOT_CONFIGURED' }
  | { status: 'FAILED'; error: string };

export type SendRefusal = 'NOT_FOUND' | 'NO_CONCERNS' | 'UNANSWERED' | 'CHANGED' | 'REGRADED';

export type SendOutcome =
  | { ok: true; mail: MailOutcome; published: boolean }
  | { ok: false; reason: SendRefusal; missing?: number[] };

const READY_REFUSALS = new Set<string>(['NO_CONCERNS', 'UNANSWERED', 'CHANGED', 'REGRADED']);

/**
 * 답이 다 달렸으면 PDF 를 만들어 보낸다. 이미 보낸 것을 고쳐 다시 보낼 때도 같은 길이다.
 *
 *   1) 다 달렸는지 본다 (화면에서도 막지만 여기서 다시)
 *   2) PDF 를 만들어 새 이름으로 올린다
 *   3) DB 가 같은 잠금 안에서 한 번 더 확인하고 '보냄' 으로 표시한다 — 여기서 거절되면
 *      올린 PDF 를 지우고 멈춘다. PDF 에 점수가 들어갔으면 같은 잠금 안에서 두 가지를 더 한다:
 *      PDF 를 만들 때 읽은 정오가 지금도 같은지 보고(학생이 그사이 사진을 바꾸면 사진 채점이
 *      비워진다 — 그러면 REGRADED 로 멈춘다), 같으면 점수를 학생에게 연다.
 *   4) 메일을 보내고, 결과를 응시 행에 적는다. 메일이 안 가도 학생은 화면에서 받는다.
 */
export async function sendFeedback(attemptId: string): Promise<SendOutcome> {
  const built = await buildFeedback(attemptId);
  if (!built) return { ok: false, reason: 'NOT_FOUND' };
  if (built.concerns.length === 0) return { ok: false, reason: 'NO_CONCERNS' };

  const progress = progressOf(built.concerns);
  if (progress.missing.length > 0) return { ok: false, reason: 'UNANSWERED', missing: progress.missing };

  const pdf = await renderFeedback(built);
  const path = paths.feedback(attemptId);
  await putFile(path, pdf, 'application/pdf');

  const publish = built.scored && built.attempt.status !== 'published';
  const { error } = await db().rpc('mark_feedback_ready', {
    payload: {
      attempt_id: attemptId,
      path,
      concern_ids: built.concerns.map((c) => c.id),
      publish,
      // DB 가 같은 모양으로 다시 줄 세워 견준다. 여기서의 순서는 상관없다.
      answers: publish
        ? built.answers.map((a) => ({ question_id: a.question_id, correct: a.correct, chosen: a.chosen }))
        : [],
    },
  });
  if (error) {
    await removeFilesQuietly([path]);
    if (error.code === 'P0001' && READY_REFUSALS.has(error.message)) {
      return { ok: false, reason: error.message as SendRefusal };
    }
    throw error;
  }

  // 지난번에 보낸 PDF. 이제 아무도 안 가리킨다.
  if (built.attempt.feedback_path && built.attempt.feedback_path !== path) {
    await removeFilesQuietly([built.attempt.feedback_path]);
  }

  const mail = await mailFeedback(built, pdf);
  await recordMail(attemptId, mail);
  return { ok: true, mail, published: publish };
}

async function mailFeedback(built: BuiltFeedback, pdf: Uint8Array): Promise<MailOutcome> {
  if (!mailConfigured()) return { status: 'NOT_CONFIGURED' };
  const to = built.student.email?.trim();
  if (!to) return { status: 'NO_EMAIL' };

  try {
    await sendFeedbackMail({
      to,
      replyTo: built.tutor?.email ?? null,
      studentName: built.student.name,
      tutorName: built.tutor?.name ?? null,
      courseName: built.course.name,
      examId: built.exam.id,
      examTitle: built.exam.title,
      concernCount: built.concerns.length,
      pdf,
    });
    return { status: 'SENT', to };
  } catch (error) {
    console.error('[lms] 답변 메일 실패', error);
    return { status: 'FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

/**
 * 메일 결과를 응시 행에 적는다. 여기서 실패해도 던지지 않는다 — PDF 는 이미 '보냄' 으로
 * 표시됐고 메일도 나갔을 수 있다. 여기서 던지면 튜터가 다시 눌러 같은 메일이 두 번 간다.
 */
async function recordMail(attemptId: string, mail: MailOutcome): Promise<void> {
  const patch =
    mail.status === 'SENT'
      ? { mailed_at: new Date().toISOString(), mailed_to: mail.to, mail_error: null }
      : { mail_error: mail.status === 'FAILED' ? mail.error : mail.status };
  const { error } = await db().from('lms_attempts').update(patch).eq('id', attemptId);
  if (error) console.error('[lms] 메일 결과를 못 적었어요', attemptId, error);
}

/** 메일 결과를 화면 말로. 코드가 아닌 것은 SMTP 가 돌려준 말이라 그대로 붙인다. */
export function mailErrorText(code: string | null): string | null {
  if (!code) return null;
  if (code === 'NO_EMAIL') return '학생 계정에 메일 주소가 없어 메일은 안 보냈어요. 학생 화면에서는 받을 수 있어요.';
  if (code === 'NOT_CONFIGURED') return '메일 설정(GMAIL_USER · GMAIL_APP_PASSWORD)이 없어 메일은 안 보냈어요. 학생 화면에서는 받을 수 있어요.';
  return `메일이 실패했어요 — ${code}. 학생 화면에서는 받을 수 있어요.`;
}

/** 학생이 받을 PDF. 보내기 전이면 null. */
export async function feedbackPdfOf(attempt: AttemptRow): Promise<Uint8Array | null> {
  if (!attempt.feedback_ready_at || !attempt.feedback_path) return null;
  return getFile(attempt.feedback_path);
}

/* ──────────────────────────────────────────────────────────── 목록들 */

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
    db().from('lms_exams').select('id, course_id, title, exam_date, due_date, status, created_at').in('course_id', b).order('id'));
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
      .select('id, course_id, title, exam_date, due_date, status, created_at')
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
