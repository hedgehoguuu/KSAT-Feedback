import 'server-only';
import {
  applicationPurgeDate,
  type ApplicationStatus,
  type ClassStatus,
} from '@/config/class';
import { supabaseAdmin } from './supabase/admin';

/** 튜터 증빙 이미지. 학생 시험지(exam-papers)와 섞지 않는다 — 보관 규칙이 다르다. */
export const PROOF_BUCKET = 'tutor-proof';
/** 증빙 이미지를 보여줄 때 쓰는 서명 URL 유효기간 (초). 짧게 준다. */
const PROOF_URL_TTL = 60 * 30;
/** 버킷(0005_classes.sql)에 걸어 둔 것과 같은 값. 두 곳이 어긋나면 안 된다. */
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
  /** 이 반이 쓰는 실전 모의고사 (예: 이감 파이널 모의고사) */
  mock_exam: string | null;
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
  | 'mock_exam'
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
  /**
   * 신청 알림 메일이 어떻게 됐나 (0013).
   * 둘 다 없으면 '모름' 이다 — 0013 을 돌리기 전에 들어온 신청이거나, 아직 보내는 중이다.
   * 안 갔다고 단정하지 않는다. 없는 사고를 만들지 않기 위해서다.
   */
  alert_sent_at?: string | null;
  alert_error?: string | null;
};

export type ApplicationListItem = ApplicationRow & {
  classTitle: string;
  classSlug: string;
  /** 적어 준 접수번호가 9모 접수에 실제로 있는가. 없어도 신청은 받는다. */
  receiptMatched: boolean | null;
};

/** 0005 까지의 열. 0006 을 아직 안 돌린 데이터베이스에도 있는 것들이다. */
const CLASS_COLUMNS_BASE =
  'id, slug, subject_code, title, schedule_text, starts_on, sessions, location, ' +
  'tutor_name, tutor_school, tutor_percentile, proof_paths, recommend, detail, ' +
  'capacity, price, price_note, status, sort_order, updated_at';
const CLASS_COLUMNS = `${CLASS_COLUMNS_BASE}, mock_exam`;

/** 0012 까지의 열. 0013 을 아직 안 돌린 데이터베이스에도 있는 것들이다. */
const APPLICATION_COLUMNS_BASE =
  'id, class_id, student_name, receipt_no, parent_phone, status, memo, created_at, purge_after, ' +
  'classes(title, slug)';
const APPLICATION_COLUMNS = `${APPLICATION_COLUMNS_BASE}, alert_sent_at, alert_error`;

/**
 * 없는 열을 물었을 때 Postgres 가 주는 코드(42703).
 *
 * 배포가 먼저 나가고 SQL 을 나중에 돌리면 잠깐 이 상태가 된다. 그때 그냥 실패시키면
 * 조회가 통째로 비어서 /class 가 '열린 반이 없어요' 로 바뀐다 — 모집 중인 페이지가
 * 빈 화면이 되는 셈이다. 그래서 새 열을 빼고 한 번 더 물어본다.
 */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703';
}

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
 * 반 목록을 부른 결과.
 *
 * '못 불러왔다' 와 '불러왔는데 없다' 를 구분해서 준다. 예전에는 오류일 때도 빈 배열을
 * 줬는데, 그러면 데이터베이스가 잠깐 흔들리는 동안 모집 페이지가 "지금은 열린 반이
 * 없어요" 로 바뀐다. 방문자에게 사실이 아닌 말을 하고, 그날 온 사람을 전부 놓친다.
 */
export type ClassList = { rows: ClassCard[]; failed: boolean };

/**
 * 반 목록. `onlyOpen` 이면 모집중인 것만 — 초안은 학생에게 보이지 않는다.
 */
export async function listClasses({ onlyOpen }: { onlyOpen: boolean }): Promise<ClassList> {
  const db = supabaseAdmin();
  if (!db) return { rows: [], failed: true };

  const ask = (columns: string) => {
    let query = db.from('classes').select(columns);
    if (onlyOpen) query = query.eq('status', 'open');
    return query
      .order('sort_order', { ascending: true })
      .order('starts_on', { ascending: true, nullsFirst: false });
  };

  let { data, error } = await ask(CLASS_COLUMNS);
  if (isMissingColumn(error)) ({ data, error } = await ask(CLASS_COLUMNS_BASE));

  if (error || !data) {
    console.error('[classes] 목록 조회 실패', error);
    return { rows: [], failed: true };
  }

  const rows = data as unknown as ClassRow[];
  const taken = await seatCounts(rows.map((r) => r.id));
  return { rows: rows.map((r) => toCard(r, taken.get(r.id) ?? 0)), failed: false };
}

export async function getClass(slug: string): Promise<ClassCard | null> {
  const db = supabaseAdmin();
  if (!db) return null;

  const ask = (columns: string) =>
    db.from('classes').select(columns).eq('slug', slug).maybeSingle();

  let { data, error } = await ask(CLASS_COLUMNS);
  if (isMissingColumn(error)) ({ data, error } = await ask(CLASS_COLUMNS_BASE));

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
  mock_exam: string | null;
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

  if (isMissingColumn(error)) {
    throw new Error('Supabase 에서 0006_mock_exam.sql 을 한 번 실행해주세요');
  }
  if (error) throw new Error(error.message);
}

export async function deleteClass(slug: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const target = await getClass(slug);
  if (!target) return;

  // 신청이 들어온 반은 지우지 않는다. 신청 기록이 반을 참조하고 있고,
  // 무엇보다 그 학생에게 연락할 근거가 사라진다.
  //
  // 취소된 신청도 센다. 자리는 돌려줬어도 행은 남아 있어서, 빼먹으면 DB 의 외래키
  // 제약(on delete restrict)에 걸려 알아볼 수 없는 오류 원문이 관리자 화면에 뜬다.
  const { count } = await db
    .from('class_applications')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', target.id);

  if ((count ?? 0) > 0) throw new Error('신청이 들어온 반은 지울 수 없어요. 마감으로 바꿔주세요.');

  const { error } = await db.from('classes').delete().eq('slug', slug);
  if (error) throw new Error(error.message);
}

export async function uploadProof(slug: string, file: File): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('Supabase 연결이 없어요');

  const row = await getClass(slug);
  if (!row) throw new Error('반을 찾을 수 없어요');

  // 화면의 accept 와 "5MB 까지" 안내는 브라우저에서만 도는 안내다. 여기서 한 번 더 본다 —
  // 안 보면 버킷이 거절하면서 알아볼 수 없는 오류 원문이 그대로 화면에 뜬다.
  const ext = PROOF_TYPES[file.type];
  if (!ext) throw new Error('JPG · PNG · WEBP 이미지만 올릴 수 있어요');
  if (file.size > PROOF_MAX_BYTES) throw new Error('이미지가 5MB를 넘어요. 줄여서 올려주세요.');

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

/**
 * 이미 들어간 같은 신청이 있는가 — 같은 반 · 같은 연락처 · 같은 학생 이름.
 *
 * 응답만 유실되고 학부모님이 다시 누른 경우를 알아보려는 것이다. 이름까지 보는 이유는
 * 형제처럼 번호만 같은 다른 신청을 재시도로 착각하지 않기 위해서다 — 그쪽은 예전처럼
 * create_class_application 이 판단한다.
 *
 * 못 물어보면 null. 그러면 평소 길로 가고, DB 함수가 같은 번호를 한 번 더 막아 준다.
 */
export async function findLiveApplication(
  classId: string,
  parentPhone: string,
  studentName: string,
): Promise<string | null> {
  const db = supabaseAdmin();
  if (!db) return null;

  const { data, error } = await db
    .from('class_applications')
    .select('id')
    .eq('class_id', classId)
    .eq('parent_phone', parentPhone)
    .eq('student_name', studentName)
    .neq('status', 'canceled')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * 신청자 목록을 부른 결과. 반 목록(ClassList)과 같은 이유로 '못 불러왔다' 를 따로 준다.
 *
 * 예전에는 오류일 때 빈 배열을 줬고, 관리자 화면은 그걸 "아직 신청이 없어요" 로 그렸다.
 * 신청이 들어와 있는데 없다고 말하는 것 — 이 화면에서 가장 비싼 거짓말이다.
 */
export type ApplicationList = { rows: ApplicationListItem[]; failed: boolean };

/** 신청자 목록. 9모 접수번호가 실제로 있는 번호인지 같이 표시한다. */
export async function listApplications(): Promise<ApplicationList> {
  const db = supabaseAdmin();
  if (!db) return { rows: [], failed: true };

  const read = (columns: string) =>
    db
      .from('class_applications')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(300);

  let { data, error } = await read(APPLICATION_COLUMNS);
  // 배포가 먼저 나가고 0013 을 나중에 돌리면 잠깐 알림 칸이 없다.
  // 그것 때문에 신청자 목록이 통째로 비면 안 된다 — 칸만 빼고 다시 묻는다.
  if (isMissingColumn(error)) ({ data, error } = await read(APPLICATION_COLUMNS_BASE));

  if (error || !data) {
    console.error('[classes] 신청자 목록 조회 실패', error);
    return { rows: [], failed: true };
  }

  type Joined = ApplicationRow & { classes: { title: string; slug: string } | null };
  const rows = data as unknown as Joined[];

  // 접수번호 대조는 덤이다. 못 물어봤으면 전부 '대조 실패' 로 칠하지 않고 표시를 비운다(null).
  const receipts = [...new Set(rows.map((r) => r.receipt_no).filter((v): v is string => Boolean(v)))];
  let known: Set<string> | null = new Set<string>();
  if (receipts.length > 0) {
    const { data: found, error: lookupError } = await db
      .from('submissions')
      .select('receipt_no')
      .in('receipt_no', receipts);
    if (lookupError) known = null;
    else for (const row of (found ?? []) as { receipt_no: string }[]) known.add(row.receipt_no);
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      classTitle: r.classes?.title ?? '(삭제된 반)',
      classSlug: r.classes?.slug ?? '',
      receiptMatched: r.receipt_no && known ? known.has(r.receipt_no) : null,
    })),
    failed: false,
  };
}

/**
 * 신청 알림 메일이 어떻게 됐는지 신청 행에 적는다 (0013).
 *
 * 절대 던지지 않는다. 이걸 부르는 자리는 이미 메일이 실패한 뒤라, 여기서 또 터지면
 * 잡을 사람이 없다 — 기록하려다 기록을 잃는다. 못 적으면 로그만 남기고 넘어간다.
 *
 * 0013 을 아직 안 돌렸으면 칸이 없어서 조용히 실패한다. 그건 /setup 의
 * '신청 알림 기록' 이 빨간불로 알려 준다.
 */
export async function markApplicationAlert(id: string, error: string | null): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;

  try {
    const { error: writeError } = await db
      .from('class_applications')
      .update({
        alert_sent_at: error ? null : new Date().toISOString(),
        // 오류 원문은 길 수 있다. 화면에 한 줄로 뜨면 되는 만큼만 남긴다.
        alert_error: error ? error.slice(0, 500) : null,
      })
      .eq('id', id);

    if (writeError) console.error('[classes] 알림 결과를 적지 못했어요', writeError);
  } catch (err) {
    // 그물이 끊긴 경우. supabase-js 는 HTTP 오류만 error 로 주고, 네트워크가 끊기면 던진다.
    console.error('[classes] 알림 결과를 적지 못했어요', err);
  }
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
