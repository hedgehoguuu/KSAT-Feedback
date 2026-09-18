// 수업 신청 · 반 만들기에서 받는 칸의 규칙 — 접수번호 · 학부모 연락처 · 반 주소(slug) · 보유기간.
// 화면과 서버(api/class/apply · admin/actions)가 같은 함수를 본다.

import { CLASS } from '@/config/class';
import { fmtDay } from '@/lib/format';
import { seoulDate } from '@/lib/kst';

/** 9모 접수번호 — F{MMDD}-{3자리}. formatReceiptNo()(lib/intake/rules.ts) 가 만드는 형식과 같다. */
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

/**
 * 신청일 기준 삭제 예정일 (YYYY-MM-DD).
 * 지우는 쪽(purge_expired_applications)이 한국 날짜로 비교하므로 여기도 한국 날짜다.
 */
export function applicationPurgeDate(from: Date = new Date()): string {
  return seoulDate(from, CLASS.retentionDays);
}

/** 2026-10-16 → "10월 16일". 개강일을 안 적은 반은 null. */
export function formatStartsOn(value: string | null): string | null {
  return value ? fmtDay(value) : null;
}
