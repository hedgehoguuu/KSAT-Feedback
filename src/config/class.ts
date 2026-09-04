// 모집 페이지(/class)와 관리자 화면이 함께 보는 상수. 모집 페이지 PRD v1.1 §00 확정값.
// 여기 숫자를 고치면 화면 · 기본값 · 서버 검사가 같이 따라간다.

export const CLASS = {
  /** 한 회차 길이. 80 + 10 + 90 */
  minutes: 180,
  /** 새 반을 만들 때 채워지는 기본값. 반마다 다르게 열 수 있어 DB 에도 같은 값이 들어간다. */
  defaultPrice: 498_000,
  defaultSessions: 4,
  defaultCapacity: 3,
  defaultPriceNote: '4회 총액 · 모의고사 4회분, 스터디룸, 수업 후 피드백 포함',
  /** 신청 개인정보 보유기간. 지나면 사진과 달리 행 자체를 지운다. */
  retentionDays: 90,
} as const;

/** 180분을 어떻게 쓰는지. 화면의 자(ruler)가 이 비율을 그대로 그린다. */
export const BLOCKS = [
  { minutes: 80, label: '실전 모의고사', detail: '학생은 시험을 치고, 튜터는 옆에서 기록해요' },
  { minutes: 10, label: '휴식', detail: '튜터는 기록지를 정리해요' },
  { minutes: 90, label: '피드백', detail: '기록을 펴 놓고 이야기해요' },
] as const;

/** 피드백 90분. 01:30 에 시작해 03:00 에 끝난다. */
export const AGENDA = [
  { at: '01:30', minutes: 10, what: '시험 총평', detail: '세 명의 점수와 시간 배분을 한 화면에' },
  { at: '01:40', minutes: 30, what: '주요 문항 해설', detail: '셋 중 둘 이상이 틀린 문항만' },
  { at: '02:10', minutes: 30, what: '학생별 교정', detail: '한 명당 10분, 자기 기록만' },
  { at: '02:40', minutes: 20, what: '전반적 교정', detail: '공통 병목과 그걸 넘는 실전 개념' },
] as const;

export const CLASS_STATUS = {
  draft: '초안',
  open: '모집중',
  closed: '마감',
} as const;
export type ClassStatus = keyof typeof CLASS_STATUS;
export const CLASS_STATUSES = Object.keys(CLASS_STATUS) as ClassStatus[];
export function isClassStatus(v: string): v is ClassStatus {
  return v in CLASS_STATUS;
}

export const APPLICATION_STATUS = {
  new: '신청',
  contacted: '연락함',
  paid: '입금완료',
  canceled: '취소',
} as const;
export type ApplicationStatus = keyof typeof APPLICATION_STATUS;
export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS) as ApplicationStatus[];
export function isApplicationStatus(v: string): v is ApplicationStatus {
  return v in APPLICATION_STATUS;
}

/** 498000 → "498,000원" */
export function won(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

/** 1회당 얼마인지. 회차가 없으면 보여주지 않는다. */
export function perSession(price: number, sessions: number): number | null {
  if (!sessions || sessions <= 1) return null;
  return Math.round(price / sessions);
}

/** 9모 접수번호 — F{MMDD}-{3자리}. formatReceiptNo() 가 만드는 형식과 같다. */
const RECEIPT_SHAPE = /^F\d{4}-\d{3}$/;
export function normalizeReceiptNo(value: string): string {
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  // 하이픈을 빼고 적는 경우가 흔하다. F0902013 → F0902-013
  const bare = /^F(\d{4})(\d{3})$/.exec(v);
  return bare ? `F${bare[1]}-${bare[2]}` : v;
}
export function isReceiptNo(value: string): boolean {
  return RECEIPT_SHAPE.test(normalizeReceiptNo(value));
}

/** 학부모 연락처. 숫자만 남겨 010-0000-0000 로 맞춘다. */
export function normalizePhone(value: string): string {
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return value.trim();
}
export function isPhone(value: string): boolean {
  const d = value.replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(d);
}

/** 반 주소에 쓰는 slug. 영문 소문자·숫자·하이픈만. */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export function isSlug(value: string): boolean {
  return SLUG_SHAPE.test(value);
}

/** 신청일 기준 삭제 예정일 (YYYY-MM-DD) */
export function applicationPurgeDate(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + CLASS.retentionDays);
  return d.toISOString().slice(0, 10);
}

/** 2026-10-16 → "10월 16일" */
export function formatStartsOn(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}
