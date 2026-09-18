// 모집 페이지(/class)와 관리자 화면이 함께 보는 상수. 모집 페이지 PRD v1.1 §00 확정값.
// 여기 숫자를 고치면 화면 · 기본값 · 서버 검사가 같이 따라간다.

export const CLASS = {
  /** 한 회차 길이. 80 + 10 + 90 */
  minutes: 180,
  /** 새 반을 만들 때 채워지는 기본값. 반마다 다르게 열 수 있어 DB 에도 같은 값이 들어간다. */
  defaultPrice: 498_000,
  defaultSessions: 4,
  defaultCapacity: 3,
  // 카드가 바로 위에서 '4회 총액' 을 이미 말한다. 여기는 무엇이 들어 있는지만 적는다.
  // 가운뎃점으로 자르면 카드에서 '✓ … 포함' 한 줄씩으로 펴진다 (PriceBlock)
  defaultPriceNote: '모의고사 4회분 · 스터디룸 대관료 · 수업 후 피드백 문서 제공',
  /** 새 반을 만들 때 채워지는 실전 모의고사. 반마다 /admin 에서 바꿀 수 있다. */
  defaultMockExam: '이감 파이널 모의고사',
  /** 신청 개인정보 보유기간. 지나면 사진과 달리 행 자체를 지운다. */
  retentionDays: 90,
} as const;

// 화면에 나오는 문구·목록은 class-copy.ts 에 있다. 여기에는 숫자 · 상태값과 그 타입 가드만 둔다.
// 연락처 · 접수번호 · 주소(slug) 검사는 lib/class/fields.ts, 금액 서식은 lib/format.ts 에 있다.

export const CLASS_STATUS = {
  draft: '초안',
  open: '모집 중',
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
  paid: '입금 완료',
  canceled: '취소',
} as const;
export type ApplicationStatus = keyof typeof APPLICATION_STATUS;
export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS) as ApplicationStatus[];
export function isApplicationStatus(v: string): v is ApplicationStatus {
  return v in APPLICATION_STATUS;
}
