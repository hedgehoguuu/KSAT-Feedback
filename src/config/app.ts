// 한곳에서 바꾸는 운영 상수.
// §9 Q1·Q3~Q7 은 확정됐다. 남은 미결은 Q2(고민 문항 문구, 서현) 하나뿐이고 questions.config.ts 에 있다.

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
  /**
   * 확정 30일 — §9 Q4. 사진·PDF 자동 삭제와 서명 URL 유효기간에 쓴다.
   * 2026-08-29 결정으로 학생 화면에는 이 기간을 따로 고지하지 않는다. 삭제는 그대로 돈다.
   */
  retentionDays: 30,
  /** 확정 7일 — §9 Q5. 완료 화면 회신 예정일 계산에 쓰인다. */
  replySlaDays: 7,
  minAge: 14,
} as const;

export const BRANDING = {
  /** §9 Q6 — 커스텀 도메인 없이 vercel.app 기본 주소로 간다. 이름은 페이지 제목에만 쓰인다. */
  serviceName: '시험지 피드백',
  receiptPrefix: 'F',
  /** 학생이 문의할 곳. 완료 화면과 접수 확인 메일에 함께 나간다. */
  contactEmail: 'juhhyun10031@gmail.com',
} as const;

/** 화면에 넣고 뺄 수 있는 것들. */
export const FEATURES = {
  /** 완료 화면의 유료 전환 사전 의향 버튼 (PRD §4 완료 · P1-3). §9 Q7 — 끄기로 확정. */
  conversionCta: false,
} as const;

/**
 * 접수 스위치 기본값 (OPS-1). 실제 운영값은 Supabase `app_settings` 한 줄이 덮는다.
 * 여기 값은 DB 를 못 읽을 때의 폴백일 뿐이다.
 */
export const INTAKE_DEFAULTS = {
  open: true,
  /** §9 Q3 — 상한 없이 간다. 필요해지면 app_settings.capacity 에 숫자만 넣으면 즉시 걸린다. */
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
