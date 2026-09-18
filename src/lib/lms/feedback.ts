import 'server-only';
import { unitLabel } from '@/config/lms';
import { seoulDate } from '@/lib/kst';
import { mailConfigured } from '@/lib/mail';
import { listConcerns, progressOf, type ConcernRow } from './concerns';
import { getCourse, type CourseRow } from './courses';
import { db } from './db';
import { loadGrading, type AttemptRow, type ExamRow } from './exams';
import { getFile, paths, putFile, removeFilesQuietly } from './files';
import { sendFeedbackMail } from './mail';
import { renderFeedbackPdf, type FeedbackDoc } from './pdf/feedback-pdf';
import { loadFonts } from './pdf/fonts';
import type { AnswerRow } from './score';
import { getUser, type StudentRow, type UserRow } from './users';

/**
 * 답변 PDF — 질문과 답(concerns.ts)을 점수 · 정오표와 함께 한 권으로 묶어 저장하고 학생에게 보낸다.
 *
 * 답이 다 달렸는지 DB 가 한 번 더 확인하면 PDF 를 저장하고 학생 메일로 보낸다. 그때부터
 * 학생 화면에서도 받을 수 있고 학생 쪽은 잠긴다.
 *
 * '다 단 것' 의 확인은 화면과 DB 두 군데서 한다 (0015 mark_feedback_ready). 화면에서만
 * 보면, 튜터가 보내기를 누르는 사이 학생이 올린 질문 하나가 답 없이 잠겨 버린다.
 */

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
