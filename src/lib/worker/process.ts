import 'server-only';
import { replyDueDate } from '@/config/app';
import { findExam, type ExamCode } from '@/config/exams';
import { subjectLabel, type SubjectCode } from '@/config/subjects';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendConfirmationMail } from './mail';
import {
  createNotionPage,
  notionConfigured,
  PDF_URL_TTL_SECONDS,
  updateNotionPdfUrl,
} from './notion';
import { mergeToPdf, pdfFileName, pdfStoragePath } from './pdf';

export type ProcessResult = {
  receiptNo: string;
  claimed: boolean;
  pdf: number;
  notion: number;
  email: boolean;
  failures: string[];
};

type SubjectRow = {
  id: string;
  subject_code: SubjectCode;
  raw_score: number | null;
  /** 문항 타입에 따라 문자열이거나 {번호, 이유} 목록이다 */
  concerns: Record<string, unknown>;
  pdf_path: string | null;
  notion_page_id: string | null;
  submission_files: { storage_path: string; order_index: number }[];
};

type SubmissionRow = {
  id: string;
  receipt_no: string;
  exam_code: ExamCode;
  email: string;
  created_at: string;
  email_ok: boolean;
  submission_subjects: SubjectRow[];
};

/** 짧게 한 번만 더 시도한다. 그 이상은 재처리 호출(/api/worker/process)에 맡긴다. */
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 600));
    return fn();
  }
}

/**
 * 접수 1건을 끝까지 처리한다 — 과목별 PDF 병합 → Notion 등록 → 접수 확인 메일.
 *
 * 단계마다 따로 실패를 받아낸다. PDF 가 실패해도 Notion 등록과 메일은 나간다.
 * 이미 끝난 단계는 건너뛰므로 여러 번 불러도 결과가 같다.
 */
export async function processSubmission(
  receiptNo: string,
  opts: { alreadyClaimed?: boolean } = {},
): Promise<ProcessResult> {
  const result: ProcessResult = {
    receiptNo, claimed: false, pdf: 0, notion: 0, email: false, failures: [],
  };

  const db = supabaseAdmin();
  if (!db) {
    result.failures.push('Supabase 연결 없음');
    return result;
  }

  // 같은 접수를 두 곳에서 동시에 처리하지 않도록 먼저 잠근다
  if (opts.alreadyClaimed) {
    result.claimed = true;
  } else {
    const { data: claimed, error: claimError } = await db.rpc('claim_submission', {
      p_receipt_no: receiptNo,
    });
    if (claimError) {
      result.failures.push(`claim 실패: ${claimError.message}`);
      return result;
    }
    if (!claimed) return result; // 이미 처리됐거나 다른 요청이 처리 중
    result.claimed = true;
  }

  const { data, error } = await db
    .from('submissions')
    .select(
      'id, receipt_no, exam_code, email, created_at, email_ok, ' +
        'submission_subjects(id, subject_code, raw_score, concerns, pdf_path, notion_page_id, ' +
        'submission_files(storage_path, order_index))',
    )
    .eq('receipt_no', receiptNo)
    .single<SubmissionRow>();

  if (error || !data) {
    await fail(receiptNo, null, 'pdf', null, `접수를 못 읽었어요: ${error?.message}`);
    await db.from('submissions').update({ status: 'failed' }).eq('receipt_no', receiptNo);
    result.failures.push('접수 조회 실패');
    return result;
  }

  const exam = findExam(data.exam_code);
  if (!exam) {
    await fail(receiptNo, data.id, 'pdf', null, `모르는 시험 코드: ${data.exam_code}`);
    await db.from('submissions').update({ status: 'failed' }).eq('id', data.id);
    result.failures.push('시험 코드 오류');
    return result;
  }

  const subjects = [...data.submission_subjects].sort(
    (a, b) => exam.subjects.indexOf(a.subject_code) - exam.subjects.indexOf(b.subject_code),
  );

  let notionOk = true;
  // 이번 판에서 다시 막힌 단계. 여기 없는 단계는 해결된 것으로 보고 실패 기록을 닫는다.
  const failedStages = new Set<string>();

  for (const subject of subjects) {
    const label = subjectLabel(subject.subject_code);
    const files = [...subject.submission_files].sort((a, b) => a.order_index - b.order_index);

    // ---------------------------------------------------------- PDF 병합
    let pdfPath = subject.pdf_path;
    let pdfJustMade = false;
    if (!pdfPath && files.length > 0) {
      try {
        // 한 장씩 순서대로 받으면 국어 16장은 왕복이 16번이라 그만큼 느려진다.
        // 페이지 순서는 위에서 order_index 로 이미 정렬해 두었고 Promise.all 이 그 순서를
        // 그대로 지키므로, 동시에 받아도 시험지 순서가 흔들리지 않는다.
        const sources = await Promise.all(
          files.map(async (file) => {
            const { data: blob, error: dlError } = await db.storage
              .from(RAW_BUCKET)
              .download(file.storage_path);
            if (dlError || !blob) throw new Error(`사진을 못 받았어요: ${dlError?.message}`);
            return {
              bytes: new Uint8Array(await blob.arrayBuffer()),
              name: file.storage_path,
            };
          }),
        );

        const merged = await mergeToPdf(sources);
        // 스토리지 키는 영문만 쓴다. 한글 이름은 내려받을 때 붙인다.
        const path = pdfStoragePath(receiptNo, subject.subject_code);
        const { error: upError } = await db.storage
          .from(RAW_BUCKET)
          .upload(path, merged, { contentType: 'application/pdf', upsert: true });
        if (upError) throw new Error(`PDF 업로드 실패: ${upError.message}`);

        await db.from('submission_subjects').update({ pdf_path: path }).eq('id', subject.id);
        pdfPath = path;
        pdfJustMade = true;
        result.pdf += 1;
      } catch (err) {
        // PDF 가 안 되더라도 접수 자체는 살린다. 튜터는 원본 사진으로 볼 수 있다.
        await fail(receiptNo, data.id, 'pdf', subject.subject_code, message(err));
        result.failures.push(`${label} PDF: ${message(err)}`);
      }
    }

    // ------------------------------------------------- 튜터에게 줄 서명 URL
    let pdfUrl: string | null = null;
    if (pdfPath) {
      const { data: signed } = await db.storage
        .from(RAW_BUCKET)
        .createSignedUrl(pdfPath, PDF_URL_TTL_SECONDS, {
          // 내려받을 때는 {접수번호}_{학년}_{과목}.pdf 로 저장되게 한다 (BE-3 AC)
          download: pdfFileName(receiptNo, exam.grade, subject.subject_code),
        });
      pdfUrl = signed?.signedUrl ?? null;
    }

    // ------------------- 먼저 등록된 페이지에 뒤늦게 만들어진 PDF 링크 채우기
    if (subject.notion_page_id && pdfUrl && pdfJustMade) {
      try {
        await retry(() => updateNotionPdfUrl(subject.notion_page_id!, pdfUrl!));
      } catch (err) {
        notionOk = false;
        await fail(receiptNo, data.id, 'notion', subject.subject_code, message(err));
        result.failures.push(`${label} Notion PDF 링크: ${message(err)}`);
      }
    }

    // -------------------------------------------------------- Notion 등록
    if (!subject.notion_page_id) {
      if (!notionConfigured()) {
        notionOk = false;
        result.failures.push('Notion 환경변수 없음');
      } else {
        try {
          const pageId = await retry(() =>
            createNotionPage({
              receiptNo,
              exam,
              subject: subject.subject_code,
              email: data.email,
              createdAt: data.created_at,
              concerns: subject.concerns ?? {},
              photoCount: files.length,
              rawScore: subject.raw_score,
              pdfUrl,
            }),
          );
          await db
            .from('submission_subjects')
            .update({ notion_page_id: pageId })
            .eq('id', subject.id);
          result.notion += 1;
        } catch (err) {
          notionOk = false;
          await fail(receiptNo, data.id, 'notion', subject.subject_code, message(err));
          result.failures.push(`${label} Notion: ${message(err)}`);
        }
      }
    }
  }

  // ------------------------------------------------------- 접수 확인 메일
  let emailOk = data.email_ok;
  if (!emailOk) {
    if (!mailConfigured()) {
      result.failures.push('메일 환경변수 없음');
    } else {
      try {
        await sendConfirmationMail({
          receiptNo,
          to: data.email,
          dueDate: replyDueDate(new Date(data.created_at)),
          exam,
          subjects: subjects.map((s) => ({
            code: s.subject_code,
            photoCount: s.submission_files.length,
            rawScore: s.raw_score,
          })),
        });
        emailOk = true;
        result.email = true;
      } catch (err) {
        await fail(receiptNo, data.id, 'email', null, message(err));
        result.failures.push(`메일: ${message(err)}`);
      }
    }
  }

  // 이번에 통과한 단계의 옛 실패 기록을 닫는다 — /setup 의 미해결 오류 수가 실제와 맞도록
  const resolvedStages = (['pdf', 'notion', 'email'] as const).filter((st) => !failedStages.has(st));
  if (resolvedStages.length > 0) {
    await db
      .from('sync_failures')
      .update({ resolved: true })
      .eq('submission_id', data.id)
      .in('stage', resolvedStages)
      .eq('resolved', false);
  }

  const done = result.failures.length === 0;
  await db
    .from('submissions')
    .update({
      status: done ? 'synced' : 'failed',
      notion_ok: notionOk,
      email_ok: emailOk,
      processed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', data.id);

  return result;

  async function fail(
    receipt: string,
    submissionId: string | null,
    stage: 'pdf' | 'notion' | 'email',
    subjectCode: string | null,
    error: string,
  ) {
    console.error(`[worker] ${receipt} ${stage} ${subjectCode ?? ''} — ${error}`);
    failedStages.add(stage);
    await db!.from('sync_failures').insert({
      submission_id: submissionId,
      receipt_no: receipt,
      stage,
      subject_code: subjectCode,
      error: error.slice(0, 1000),
    });
  }
}

/**
 * 밀린 접수를 순서대로 처리한다.
 * 함수가 잘리면 그 건은 'processing' 인 채로 남아 10분 뒤 다시 집어오게 되므로,
 * 남은 시간이 한 건을 처리하기에 빠듯하면 더 시작하지 않는다.
 */
export async function processPending(limit = 5, budgetMs = 45_000): Promise<ProcessResult[]> {
  const db = supabaseAdmin();
  if (!db) return [];

  const startedAt = Date.now();
  const results: ProcessResult[] = [];

  for (let i = 0; i < limit; i += 1) {
    if (Date.now() - startedAt > budgetMs) break;
    const { data: receiptNo } = await db.rpc('claim_submission', { p_receipt_no: null });
    if (!receiptNo) break;
    results.push(await processSubmission(receiptNo as string, { alreadyClaimed: true }));
  }
  return results;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
