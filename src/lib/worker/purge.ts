import 'server-only';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

type SubjectRow = {
  subject_code: string;
  pdf_path: string | null;
  notion_page_id: string | null;
  submission_files: { storage_path: string }[];
};

type Row = { id: string; receipt_no: string; submission_subjects: SubjectRow[] };

const SELECT =
  'id, receipt_no, submission_subjects(subject_code, pdf_path, notion_page_id, ' +
  'submission_files(storage_path))';

function filePaths(row: Row): string[] {
  return row.submission_subjects.flatMap((s) => [
    ...s.submission_files.map((f) => f.storage_path),
    ...(s.pdf_path ? [s.pdf_path] : []),
  ]);
}

/**
 * 보관 기간이 지난 접수의 사진·PDF 를 지운다 (SEC-1).
 * 접수 기록 자체는 남긴다 — 몇 건을 받았고 언제 회신했는지는 계속 봐야 하기 때문이다.
 */
export async function purgeExpiredFiles(limit = 50): Promise<{ purged: string[]; errors: string[] }> {
  const db = supabaseAdmin();
  if (!db) return { purged: [], errors: ['supabase 연결 없음'] };

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from('submissions')
    .select(SELECT)
    .lt('purge_after', today)
    .neq('status', 'purged')
    .limit(limit);

  if (error) return { purged: [], errors: [error.message] };

  const rows = (data ?? []) as unknown as Row[];
  const purged: string[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const paths = filePaths(row);
    if (paths.length > 0) {
      const { error: rmError } = await db.storage.from(RAW_BUCKET).remove(paths);
      if (rmError) {
        errors.push(`${row.receipt_no}: ${rmError.message}`);
        continue;
      }
    }
    await db.from('submissions').update({ status: 'purged' }).eq('id', row.id);
    purged.push(row.receipt_no);
  }

  return { purged, errors };
}

/**
 * 접수 1건을 통째로 지운다 — 사진·PDF·DB 기록, 그리고 Notion 페이지까지.
 * 테스트로 넣은 접수를 치울 때 쓴다. 되돌릴 수 없다.
 */
export async function deleteSubmission(receiptNo: string): Promise<{
  receiptNo: string;
  files: number;
  notionArchived: number;
  deleted: boolean;
  errors: string[];
}> {
  const result = { receiptNo, files: 0, notionArchived: 0, deleted: false, errors: [] as string[] };

  const db = supabaseAdmin();
  if (!db) {
    result.errors.push('supabase 연결 없음');
    return result;
  }

  const { data, error } = await db
    .from('submissions')
    .select(SELECT)
    .eq('receipt_no', receiptNo)
    .maybeSingle();

  if (error) {
    result.errors.push(error.message);
    return result;
  }
  if (!data) {
    result.errors.push('그런 접수번호가 없어요');
    return result;
  }

  const row = data as unknown as Row;

  // 1) 저장소의 사진과 PDF
  const paths = filePaths(row);
  if (paths.length > 0) {
    const { error: rmError } = await db.storage.from(RAW_BUCKET).remove(paths);
    if (rmError) result.errors.push(`저장소: ${rmError.message}`);
    else result.files = paths.length;
  }

  // 2) Notion 페이지 (휴지통으로 보낸다)
  const token = process.env.NOTION_TOKEN;
  for (const subject of row.submission_subjects) {
    if (!subject.notion_page_id || !token) continue;
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${subject.notion_page_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) result.notionArchived += 1;
      else result.errors.push(`Notion ${subject.subject_code}: ${res.status}`);
    } catch (err) {
      result.errors.push(`Notion ${subject.subject_code}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 3) DB 기록 (과목·파일·실패 로그는 연결이 걸려 있어 같이 지워진다)
  const { error: delError } = await db.from('submissions').delete().eq('id', row.id);
  if (delError) result.errors.push(`DB: ${delError.message}`);
  else result.deleted = true;

  return result;
}
