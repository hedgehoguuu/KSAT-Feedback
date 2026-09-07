import 'server-only';
import { findExam, type ExamCode } from '@/config/exams';
import {
  answerText,
  isAnswered,
  questionsFor as concernQuestionsFor,
  type ConcernValue,
} from '@/config/questions.config';
import { isSubjectCode, subjectLabel, type SubjectCode } from '@/config/subjects';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * 9월에 받은 시험지 피드백(/apply)을 LMS 학생에게 이어 붙인다.
 *
 * 이 서비스가 학생을 처음 만난 자리가 거기다. 그때 학생이 직접 적어 준 고민
 * — 어느 문항에서 시간이 샜는지, 무엇이 안 보였는지 — 은 지금 수업에서 가장 값진 재료인데,
 * 접수번호만 적어 두고 안 보면 없는 것과 같다.
 *
 * 사진과 PDF 는 접수일 + 30일에 지워지지만(lib/worker/purge.ts) 접수 기록과 고민 답변은
 * 남는다. 그래서 사진이 사라진 뒤에도 여기는 계속 읽힌다 — 사진이 없다는 것만 말해 준다.
 */

export type IntakeConcern = { question: string; answer: string };

export type IntakeSubject = {
  code: SubjectCode;
  label: string;
  concerns: IntakeConcern[];
  pageCount: number;
};

export type IntakeSummary = {
  receiptNo: string;
  examLabel: string;
  grade: number;
  createdAt: string;
  /** 사진·PDF 가 보관 기간이 지나 지워졌는가. 고민 답변은 그대로다. */
  filesGone: boolean;
  subjects: IntakeSubject[];
};

type Row = {
  receipt_no: string;
  exam_code: string;
  grade: number;
  status: string;
  created_at: string;
  submission_subjects: {
    subject_code: string;
    concerns: Record<string, unknown> | null;
    page_count: number | null;
  }[];
};

/**
 * 접수번호로 찾는다. 없으면 null — 번호를 잘못 적었거나 아직 접수한 적이 없는 학생이다.
 * 둘 다 화면에서는 '연결된 접수가 없어요' 로 같게 다룬다.
 */
export async function findIntake(receiptNo: string | null | undefined): Promise<IntakeSummary | null> {
  const no = receiptNo?.trim();
  if (!no) return null;

  const db = supabaseAdmin();
  if (!db) return null;

  const { data } = await db
    .from('submissions')
    .select(
      'receipt_no, exam_code, grade, status, created_at, ' +
        'submission_subjects(subject_code, concerns, page_count)',
    )
    .eq('receipt_no', no)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as Row;

  const subjects: IntakeSubject[] = (row.submission_subjects ?? [])
    .filter((s) => isSubjectCode(s.subject_code))
    .map((s) => {
      const code = s.subject_code as SubjectCode;
      const answers = (s.concerns ?? {}) as Record<string, ConcernValue>;
      return {
        code,
        label: subjectLabel(code),
        pageCount: s.page_count ?? 0,
        // 안 적은 문항은 빼고 준다. 빈 줄이 늘어서 있으면 적어 준 것이 안 보인다.
        concerns: concernQuestionsFor(code)
          .filter((q) => isAnswered(q, answers[q.id]))
          .map((q) => ({
            question: q.label.replace('{subject}', subjectLabel(code)),
            answer: answerText(q, answers[q.id]),
          })),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  return {
    receiptNo: row.receipt_no,
    examLabel: findExam(row.exam_code as ExamCode)?.shortLabel ?? row.exam_code,
    grade: row.grade,
    createdAt: row.created_at,
    filesGone: row.status === 'purged',
    subjects,
  };
}
