import 'server-only';
import {
  CLASS,
  applicationPurgeDate,
  type ApplicationStatus,
  type ClassStatus,
} from '@/config/class';
import { supabaseAdmin } from './supabase/admin';

/** 튜터 증빙 이미지. 학생 시험지(exam-papers)와 섞지 않는다 — 보관 규칙이 다르다. */
export const PROOF_BUCKET = 'tutor-proof';
/** 증빙 이미지를 보여줄 때 쓰는 서명 URL 유효기간 (초). 짧게 준다. */
const PROOF_URL_TTL = 60 * 30;

export type ClassRow = {
  id: string;
  slug: string;
  subject_code: string;
  title: string;
  schedule_text: string;
  starts_on: string | null;
  sessions: number;
  location: string;
  tutor_name: string;
  tutor_school: string | null;
  tutor_percentile: number | null;
  proof_paths: string[];
  recommend: string | null;
  detail: string | null;
  capacity: number;
  price: number;
  price_note: string;
  status: ClassStatus;
  sort_order: number;
  updated_at: string;
};

export type ClassCard = ClassRow & {
  /** 취소를 뺀 신청 수 */
  taken: number;
  seatsLeft: number;
  full: boolean;
};

/** 화면 부품(ClassMeta·PriceBlock)이 필요로 하는 만큼만. ClassCard 를 그대로 넣어도 맞는다. */
export type ClassSummary = Pick<
  ClassRow,
  | 'slug'
  | 'title'
  | 'schedule_text'
  | 'starts_on'
  | 'sessions'
  | 'location'
  | 'tutor_name'
  | 'tutor_school'
  | 'tutor_percentile'
  | 'price'
  | 'price_note'
>;

export type ApplicationRow = {
  id: string;
  class_id: string;
  student_name: string;
  receipt_no: string | null;
  parent_phone: string;
  status: ApplicationStatus;
  memo: string | null;
  created_at: string;
  purge_after: string;
};

export type ApplicationListItem = ApplicationRow & {
  classTitle: string;
  classSlug: string;
  /** 적어 준 접수번호가 9모 접수에 실제로 있는가. 없어도 신청은 받는다. */
  receiptMatched: boolean | null;
};

const CLASS_COLUMNS =
  'id, slug, subject_code, title, schedule_text, starts_on, sessions, location, ' +
  'tutor_name, tutor_school, tutor_percentile, proof_paths, recommend, detail, ' +
  'capacity, price, price_note, status, sort_order, updated_at';

/** 반마다 몇 자리가 찼는지. 취소한 신청은 자리를 돌려준다. */
async function seatCounts(classIds: string[]): Promise<Map<string, number>> {
  const taken = new Map<string, number>();
  const db = supabaseAdmin();
  if (!db || classIds.length === 0) return taken;

  const { data, error } = await db
    .from('class_applications')
    .select('class_id')
    .neq('status', 'canceled')
    .in('class_id', classIds);

  // 못 세면 0 으로 둔다. 자리 수를 못 읽었다고 반을 통째로 숨기지 않는다.
  if (error || !data) return taken;
  for (const row of data as { class_id: string }[]) {
    taken.set(row.class_id, (taken.get(row.class_id) ?? 0) + 1);
  }
  return taken;
}

function toCard(row: ClassRow, taken: number): ClassCard {
  const seatsLeft = Math.max(0, row.capacity - taken);
  return { ...row, taken, seatsLeft, full: seatsLeft === 0 };
}

/**
 * 반 목록. `onlyOpen` 이면 모집중인 것만 — 초안은 학생에게 보이지 않는다.
 * Supabase 가 없으면 빈 배열이다. 화면은 빈 상태를 따로 그린다.
 */
export async function listClasses({ onlyOpen }: { onlyOpen: boolean }): Promise<ClassCard[]> {
  const db = supabaseAdmin();
  if (!db) return [];

  let query = db.from('classes').select(CLASS_COLUMNS);
  if (onlyOpen) query = query.eq('status', 'open');

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('starts_on', { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  const rows = data as unknown as ClassRow[];
  const taken = await seatCounts(rows.map((r) => r.id));
  return rows.map((r) => toCard(r, taken.get(r.id) ?? 0));
}

export async function getClass(slug: string): Promise<ClassCard | null> {
  const db = supabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from('classes')
    .select(CLASS_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as ClassRow;
  const taken = await seatCounts([row.id]);
  return toCard(row, taken.get(row.id) ?? 0);
}

/**
 * 증빙 이미지 주소. 비공개 버킷이라 볼 때마다 유효기간 있는 주소를 새로 만든다.
 * 버킷을 공개로 열지 않는 이유는, 주소가 한 번 새면 계속 열려 있기 때문이다.
 */
export async function signProofUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const db = supabaseAdmin();
  if (!db || paths.length === 0) return urls;

  const { data, error } = await db.storage.from(PROOF_BUCKET).createSignedUrls(paths, PROOF_URL_TTL);
  if (error || !data) return urls;
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

export type ClassInput = {
  slug: string;
  title: string;
  schedule_text: string;
  starts_on: string | null;
  sessions: number;
  location: string;
  tutor_name: string;
  tutor_school: string | null;
  tutor_percentile: number | null;
  recommend: string | null;
  detail: string | null;
  capacity: number;
  price: number;
  price_note: string;
  status: ClassStatus;
  sort_order: number;
};

/** 반 만들기 · 고치기. slug 가 같으면 덮어쓴다. */
export async function saveClass(input: ClassInput): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const { error } = await db
    .from('classes')
    .upsert({ ...input, updated_at: new Date().toISOString() }, { onConflict: 'slug' });

  if (error) throw new Error(error.message);
}

export async function deleteClass(slug: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const target = await getClass(slug);
  if (!target) return;
  // 신청이 들어온 반은 지우지 않는다. 신청 기록이 반을 참조하고 있고,
  // 무엇보다 그 학생에게 연락할 근거가 사라진다.
  if (target.taken > 0) throw new Error('신청이 들어온 반은 지울 수 없어요. 마감으로 바꿔주세요.');

  const { error } = await db.from('classes').delete().eq('slug', slug);
  if (error) throw new Error(error.message);
}

export async function uploadProof(slug: string, file: File): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const row = await getClass(slug);
  if (!row) throw new Error('반을 찾을 수 없어요');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${slug}/${crypto.randomUUID()}.${ext}`;

  const { error } = await db.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const { error: linkError } = await db
    .from('classes')
    .update({ proof_paths: [...row.proof_paths, path], updated_at: new Date().toISOString() })
    .eq('slug', slug);
  if (linkError) throw new Error(linkError.message);
}

export async function removeProof(slug: string, path: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const row = await getClass(slug);
  if (!row || !row.proof_paths.includes(path)) return;

  await db.storage.from(PROOF_BUCKET).remove([path]);
  const { error } = await db
    .from('classes')
    .update({
      proof_paths: row.proof_paths.filter((p) => p !== path),
      updated_at: new Date().toISOString(),
    })
    .eq('slug', slug);
  if (error) throw new Error(error.message);
}

export type ApplyInput = {
  slug: string;
  studentName: string;
  receiptNo: string;
  parentPhone: string;
};

export class ApplyError extends Error {
  constructor(
    message: string,
    readonly code: 'CLASS_NOT_OPEN' | 'CLASS_FULL' | 'UNKNOWN',
  ) {
    super(message);
    this.name = 'ApplyError';
  }
}

/**
 * 신청 한 건. 정원 초과는 여기(트랜잭션 안)에서 막는다 —
 * 화면에서만 막으면 마지막 자리를 동시에 누른 두 명이 둘 다 통과한다.
 */
export async function applyToClass(input: ApplyInput): Promise<string> {
  const db = supabaseAdmin();
  if (!db) throw new ApplyError('지금은 신청을 받을 수 없어요. 잠시 뒤 다시 시도해주세요.', 'UNKNOWN');

  const { data, error } = await db.rpc('create_class_application', {
    payload: {
      slug: input.slug,
      student_name: input.studentName,
      receipt_no: input.receiptNo,
      parent_phone: input.parentPhone,
      consent_at: new Date().toISOString(),
      purge_after: applicationPurgeDate(),
    },
  });

  if (error) {
    const text = `${error.message} ${error.hint ?? ''}`;
    if (text.includes('CLASS_FULL')) {
      throw new ApplyError('그 사이에 자리가 다 찼어요. 다른 반을 봐주세요.', 'CLASS_FULL');
    }
    if (text.includes('CLASS_NOT_OPEN')) {
      throw new ApplyError('지금 신청을 받고 있지 않은 반이에요.', 'CLASS_NOT_OPEN');
    }
    throw new ApplyError('신청이 안 됐어요. 다시 눌러주세요.', 'UNKNOWN');
  }

  return String(data);
}

/** 신청자 목록. 9모 접수번호가 실제로 있는 번호인지 같이 표시한다. */
export async function listApplications(): Promise<ApplicationListItem[]> {
  const db = supabaseAdmin();
  if (!db) return [];

  const { data, error } = await db
    .from('class_applications')
    .select(
      'id, class_id, student_name, receipt_no, parent_phone, status, memo, created_at, purge_after, ' +
        'classes(title, slug)',
    )
    .order('created_at', { ascending: false })
    .limit(300);

  if (error || !data) return [];

  type Joined = ApplicationRow & { classes: { title: string; slug: string } | null };
  const rows = data as unknown as Joined[];

  const receipts = [...new Set(rows.map((r) => r.receipt_no).filter((v): v is string => Boolean(v)))];
  const known = new Set<string>();
  if (receipts.length > 0) {
    const { data: found } = await db
      .from('submissions')
      .select('receipt_no')
      .in('receipt_no', receipts);
    for (const row of (found ?? []) as { receipt_no: string }[]) known.add(row.receipt_no);
  }

  return rows.map((r) => ({
    ...r,
    classTitle: r.classes?.title ?? '(삭제된 반)',
    classSlug: r.classes?.slug ?? '',
    receiptMatched: r.receipt_no ? known.has(r.receipt_no) : null,
  }));
}

export async function setApplicationStatus(id: string, status: ApplicationStatus): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const { error } = await db.from('class_applications').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 보유기간이 지난 신청을 지운다. 사진과 달리 행 자체를 지운다. */
export async function purgeExpiredApplications(): Promise<number> {
  const db = supabaseAdmin();
  if (!db) return 0;

  const { data, error } = await db.rpc('purge_expired_applications');
  if (error || typeof data !== 'number') return 0;
  return data;
}

export const RETENTION_DAYS = CLASS.retentionDays;
