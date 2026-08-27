// 과목 정의. 코드에 '국어'·'수학'을 하드코딩하지 않기 위한 단일 출처. (PRD §6 P2 설계 원칙)

export type SubjectCode = 'korean' | 'math' | 'english' | 'int_sci' | 'int_soc';

export type Subject = {
  code: SubjectCode;
  label: string;
  /** 접수 스위치(OPS-1)로 과목별 on/off. 기본값이며 런타임 설정이 우선한다. */
  enabled: boolean;
};

export const SUBJECTS: readonly Subject[] = [
  { code: 'korean', label: '국어', enabled: true },
  { code: 'math', label: '수학', enabled: true },
  { code: 'english', label: '영어', enabled: true },
  { code: 'int_sci', label: '통합과학', enabled: true },
  { code: 'int_soc', label: '통합사회', enabled: true },
] as const;

const BY_CODE = new Map(SUBJECTS.map((s) => [s.code, s]));

export function subjectLabel(code: SubjectCode): string {
  return BY_CODE.get(code)?.label ?? code;
}

export function isSubjectCode(v: string): v is SubjectCode {
  return BY_CODE.has(v as SubjectCode);
}
