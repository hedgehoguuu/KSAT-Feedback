import { SUBJECTS, subjectLabel, type SubjectCode } from './subjects';

// 한곳에서 바꾸는 운영 상수.
// §9 Q1·Q3~Q7 은 확정됐다. 남은 미결은 Q2(고민 문항 문구, 서현) 하나뿐이고 questions.config.ts 에 있다.

export const LIMITS = {
  /** 과목당 최대 장수 (PRD §4 ②). 아래 예외에 없는 과목이 쓰는 기본값이다. */
  maxPhotosPerSubject: 12,
  /**
   * 과목별 예외 (2026-08-30). 국어는 학생 문제지가 실제로 16장이라 12장으로는 모자란다.
   * 다른 과목도 장수가 다르면 여기에 한 줄씩 더하면 된다 — 화면·서버·안내 문구가 같이 따라간다.
   */
  maxPhotosBySubject: { korean: 16 } as Partial<Record<SubjectCode, number>>,
  /**
   * 접수 1건 전체 최대 장수.
   * 국어 16 + 두 과목 12 = 40 이라 세 과목까지는 그대로 들어간다.
   */
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
  /** 통틀어 몇 건. 상한 없이 간다 — 하루 상한만 쓴다. */
  capacity: null as number | null,
  /**
   * 하루 몇 건 (2026-08-29 결정 · 100건).
   * 한국 날짜가 바뀌면 저절로 다시 열린다. 실제 운영값은 app_settings.daily_capacity 다.
   */
  dailyCapacity: 100 as number | null,
  closedReason: '이번 회차 접수가 마감됐어요.',
  dailyClosedReason: '오늘 접수는 다 찼어요. 내일 다시 열려요.',
} as const;

/**
 * 이 과목은 몇 장까지 받나. 화면·서버가 모두 이 함수 하나만 본다 —
 * 한쪽만 고쳐서 화면은 받아주는데 서버가 거절하는 일이 없게 한다.
 */
export function maxPhotosFor(subject: SubjectCode): number {
  return LIMITS.maxPhotosBySubject[subject] ?? LIMITS.maxPhotosPerSubject;
}

/**
 * 기본 장수와 다른 과목만 골라 안내 문구로 만든다 ("국어는 16장").
 * 예외를 추가·삭제하면 안내도 저절로 따라간다.
 */
export function photoLimitNote(): string {
  const odd = SUBJECTS.filter((s) => maxPhotosFor(s.code) !== LIMITS.maxPhotosPerSubject);
  if (odd.length === 0) return '';
  return odd.map((s) => `${subjectLabel(s.code)}는 ${maxPhotosFor(s.code)}장`).join(', ');
}

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
