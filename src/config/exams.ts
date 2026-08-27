// 시험 정의. 시험을 고르면 학년과 과목 목록이 함께 정해진다. (PRD §4 ①)

import type { SubjectCode } from './subjects';

export type ExamCode = 'G3_KICE' | 'G2_ICE' | 'G1_ICE';

export type Exam = {
  code: ExamCode;
  /** 카드에 크게 보이는 줄 */
  title: string;
  /** 카드 보조 설명 */
  subtitle: string;
  /** 이후 화면 상단 요약에 쓰는 짧은 이름 — `고3 · 평가원 9월 모평` */
  shortLabel: string;
  /** Notion `시험` Select 값 */
  notionLabel: string;
  grade: 1 | 2 | 3;
  subjects: readonly SubjectCode[];
  enabled: boolean;
};

export const EXAMS: readonly Exam[] = [
  {
    code: 'G3_KICE',
    title: '고3 · 9월 모의평가',
    subtitle: '한국교육과정평가원',
    shortLabel: '고3 · 평가원 9월 모평',
    notionLabel: '평가원 9월 모평',
    grade: 3,
    subjects: ['korean', 'math'],
    enabled: true,
  },
  {
    code: 'G2_ICE',
    title: '고2 · 9월 학력평가',
    subtitle: '인천광역시교육청 전국연합',
    shortLabel: '고2 · 인천 9월 학평',
    notionLabel: '인천 9월 학평',
    grade: 2,
    subjects: ['korean', 'math', 'english', 'int_sci', 'int_soc'],
    enabled: true,
  },
  {
    code: 'G1_ICE',
    title: '고1 · 9월 학력평가',
    subtitle: '인천광역시교육청 전국연합',
    shortLabel: '고1 · 인천 9월 학평',
    notionLabel: '인천 9월 학평',
    grade: 1,
    subjects: ['korean', 'math', 'english', 'int_sci', 'int_soc'],
    enabled: true,
  },
] as const;

const BY_CODE = new Map(EXAMS.map((e) => [e.code, e]));

export function findExam(code: ExamCode | null | undefined): Exam | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

export function isExamCode(v: string): v is ExamCode {
  return BY_CODE.has(v as ExamCode);
}
