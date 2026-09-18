// 과목 정의. 코드에 '국어'·'수학'을 하드코딩하지 않기 위한 단일 출처. (PRD §6 P2 설계 원칙)

export type SubjectCode = 'korean' | 'math' | 'english' | 'int_sci' | 'int_soc';

export type Subject = {
  code: SubjectCode;
  label: string;
  /** 접수 스위치(OPS-1)로 과목별 on/off. 기본값이며 런타임 설정이 우선한다. */
  enabled: boolean;
  /**
   * 원점수 만점. 학생이 적은 점수가 이 값을 넘으면 오타로 보고 되돌려준다.
   * 국어·수학·영어는 100점, 고1·2 통합과학·통합사회 학력평가는 20문항 50점이다.
   * 만점이 다르면 이 숫자만 고치면 화면 안내와 서버 검사가 함께 따라간다.
   */
  maxScore: number;
};

// §9 Q1 — 고1·2 과목 5개를 모두 연다. 다시 닫을 때는 여기 enabled 를 끄거나(배포 필요),
// Supabase app_settings.disabled_subjects 에 과목 코드를 넣는다(배포 불필요).
export const SUBJECTS: readonly Subject[] = [
  { code: 'korean', label: '국어', enabled: true, maxScore: 100 },
  { code: 'math', label: '수학', enabled: true, maxScore: 100 },
  { code: 'english', label: '영어', enabled: true, maxScore: 100 },
  { code: 'int_sci', label: '통합과학', enabled: true, maxScore: 50 },
  { code: 'int_soc', label: '통합사회', enabled: true, maxScore: 50 },
] as const;

const BY_CODE = new Map(SUBJECTS.map((s) => [s.code, s]));

export function subjectLabel(code: SubjectCode): string {
  return BY_CODE.get(code)?.label ?? code;
}

export function isSubjectCode(v: string): v is SubjectCode {
  return BY_CODE.has(v as SubjectCode);
}

/** 이 과목 원점수의 만점. 화면 안내와 서버 검사가 같은 값을 본다. */
export function maxScoreOf(code: SubjectCode): number {
  return BY_CODE.get(code)?.maxScore ?? 100;
}
