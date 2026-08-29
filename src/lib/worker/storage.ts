import 'server-only';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

/**
 * 저장소 청소.
 *
 * 사진은 ②단계에서 바로 올라가는데 접수 기록은 ④단계를 끝내야 생긴다.
 * 중간에 창을 닫으면 사진만 남고 접수는 없는 '주인 없는 파일' 이 된다.
 * 무료 용량이 1GB 뿐이라 이게 쌓이면 받을 수 있는 학생 수가 줄어든다.
 */

export type Entry = { path: string; bytes: number; updatedAt: string | null };

const PAGE = 1000;
/** 한 번에 훑는 파일 수 상한. 60초 안에 끝나야 한다. */
const MAX_SCAN = 20000;
/** 삭제 요청 한 번에 보내는 경로 수 */
const REMOVE_CHUNK = 100;

/** 버킷을 통째로 훑는다. Supabase 는 한 단계씩만 보여주므로 폴더를 따라 내려간다. */
export async function listAll(prefix = ''): Promise<Entry[]> {
  const db = supabaseAdmin();
  if (!db) return [];

  const out: Entry[] = [];
  const queue: string[] = [prefix];

  while (queue.length > 0 && out.length < MAX_SCAN) {
    const dir = queue.shift()!;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.storage
        .from(RAW_BUCKET)
        .list(dir, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error || !data || data.length === 0) break;

      for (const item of data) {
        const path = dir ? `${dir}/${item.name}` : item.name;
        // 폴더는 id 가 비어 있다 — 실제 객체가 아니라 경로 조각이다
        if (item.id === null) queue.push(path);
        else {
          out.push({
            path,
            bytes: (item.metadata?.size as number | undefined) ?? 0,
            updatedAt: item.updated_at ?? item.created_at ?? null,
          });
        }
      }
      if (data.length < PAGE) break;
    }
  }

  return out;
}

/** DB 가 알고 있는 경로 — 사진과 합친 PDF 전부 */
async function referencedPaths(): Promise<Set<string>> {
  const db = supabaseAdmin();
  const set = new Set<string>();
  if (!db) return set;

  const files = await db.from('submission_files').select('storage_path');
  for (const row of files.data ?? []) if (row.storage_path) set.add(row.storage_path);

  const pdfs = await db.from('submission_subjects').select('pdf_path');
  for (const row of pdfs.data ?? []) if (row.pdf_path) set.add(row.pdf_path);

  return set;
}

function summarize(entries: Entry[]) {
  const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return { count: entries.length, bytes, mb: Math.round((bytes / 1048576) * 10) / 10 };
}

/** 지금 저장소에 무엇이 얼마나 있는지 */
export async function inventory() {
  const all = await listAll();
  const referenced = await referencedPaths();
  const orphans = all.filter((e) => !referenced.has(e.path));

  return {
    total: summarize(all),
    photos: summarize(all.filter((e) => e.path.startsWith('raw/'))),
    pdf: summarize(all.filter((e) => e.path.startsWith('pdf/'))),
    orphans: summarize(orphans),
    oldestOrphan: orphans.map((e) => e.updatedAt).filter(Boolean).sort()[0] ?? null,
    truncated: all.length >= MAX_SCAN,
  };
}

async function removeAll(paths: string[]): Promise<{ removed: number; errors: string[] }> {
  const db = supabaseAdmin();
  if (!db) return { removed: 0, errors: ['supabase 연결 없음'] };

  let removed = 0;
  const errors: string[] = [];
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    const { error } = await db.storage.from(RAW_BUCKET).remove(chunk);
    if (error) errors.push(error.message);
    else removed += chunk.length;
  }
  return { removed, errors };
}

/**
 * 접수로 이어지지 않은 파일을 지운다.
 *
 * olderThanHours 는 안전장치다 — 지금 ②단계에서 사진을 올려두고 ③단계를 쓰고 있는
 * 학생의 파일까지 지우면 안 되기 때문에, 그만큼 지난 것만 건드린다.
 */
export async function cleanupOrphans(
  opts: { olderThanHours?: number; dryRun?: boolean } = {},
): Promise<{ scanned: number; orphans: number; removed: number; mb: number; errors: string[] }> {
  const { olderThanHours = 24, dryRun = false } = opts;

  const all = await listAll();
  const referenced = await referencedPaths();
  const cutoff = Date.now() - olderThanHours * 3600_000;

  const orphans = all.filter((e) => {
    if (referenced.has(e.path)) return false;
    if (!e.updatedAt) return olderThanHours === 0;
    return new Date(e.updatedAt).getTime() < cutoff;
  });

  const { mb } = summarize(orphans);
  if (dryRun) {
    return { scanned: all.length, orphans: orphans.length, removed: 0, mb, errors: [] };
  }

  const { removed, errors } = await removeAll(orphans.map((e) => e.path));
  return { scanned: all.length, orphans: orphans.length, removed, mb, errors };
}

/**
 * 버킷을 완전히 비운다. 접수에 걸려 있는 사진까지 전부 사라진다.
 * 되돌릴 수 없다 — 접수를 열기 전에 시험 데이터를 치울 때만 쓴다.
 */
export async function wipeStorage(): Promise<{
  scanned: number;
  removed: number;
  mb: number;
  errors: string[];
}> {
  const all = await listAll();
  const { mb } = summarize(all);
  const { removed, errors } = await removeAll(all.map((e) => e.path));
  return { scanned: all.length, removed, mb, errors };
}
