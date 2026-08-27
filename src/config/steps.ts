// 진행 표시는 4단계 고정. 랜딩과 완료 화면은 단계에 포함하지 않는다. (PRD §4)

export const STEPS = [
  { key: 'exam', label: '시험', path: '/apply/exam' },
  { key: 'upload', label: '시험지', path: '/apply/upload' },
  { key: 'concerns', label: '고민', path: '/apply/concerns' },
  { key: 'email', label: '받을 곳', path: '/apply/email' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

export const TOTAL_STEPS = STEPS.length;

export function stepIndex(key: StepKey): number {
  return STEPS.findIndex((s) => s.key === key);
}

export function stepByPath(path: string) {
  return STEPS.find((s) => path.startsWith(s.path));
}
