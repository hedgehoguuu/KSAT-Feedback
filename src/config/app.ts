// 한곳에서 바꾸는 운영 상수. §9에서 미결인 값은 PROVISIONAL 로 표시했다.

export const LIMITS = {
  /** 과목당 최대 장수 (PRD §4 ②) */
  maxPhotosPerSubject: 12,
  /** 접수 1건 전체 최대 장수 */
  maxPhotosTotal: 40,
  /** 클라이언트 리사이즈 기준 — 긴 변 px (BE-1) */
  resizeLongEdge: 2000,
  /** 클라이언트 리사이즈 JPEG 품질 (BE-1) */
  jpegQuality: 0.82,
} as const;

export const POLICY = {
  /** PROVISIONAL — §9 Q4 (제안 30일). 동의 문구와 자동 삭제에 함께 쓰인다. */
  retentionDays: 30,
  /** PROVISIONAL — §9 Q5 (1주일 유지 vs 3일). 완료 화면 회신 예정일 계산에 쓰인다. */
  replySlaDays: 7,
  minAge: 14,
} as const;

export const BRANDING = {
  serviceName: '시험지 피드백', // PROVISIONAL — §9 Q6
  receiptPrefix: 'F',
} as const;

/** 화면에 넣고 뺄 수 있는 것들. §9 Q7 결론이 나면 여기만 바꾼다. */
export const FEATURES = {
  /** 완료 화면의 유료 전환 사전 의향 버튼 (PRD §4 완료 · P1-3) */
  conversionCta: false,
} as const;

/** 접수 스위치 기본값 (OPS-1). 운영 중에는 `_설정` 시트/원격 값이 이 값을 덮는다. */
export const INTAKE_DEFAULTS = {
  open: true,
  /** PROVISIONAL — §9 Q3. null 이면 상한 없음. */
  capacity: null as number | null,
  closedReason: '이번 회차 접수가 마감됐어요.',
} as const;

/** 접수일 기준 회신 예정일 (YYYY-MM-DD) */
export function replyDueDate(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + POLICY.replySlaDays);
  return d.toISOString().slice(0, 10);
}

/** 접수번호 형식: F{MMDD}-{일련번호 3자리} (BE-2) */
export function formatReceiptNo(seq: number, at: Date = new Date()): string {
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  return `${BRANDING.receiptPrefix}${mm}${dd}-${String(seq).padStart(3, '0')}`;
}
