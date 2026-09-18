// 무료 피드백 접수의 규칙 — 회신 예정일 · 접수번호 모양 · 원점수 검사.
// 숫자(기한 · 접두사 · 만점)는 config/app.ts · subjects.ts 에 있고, 여기는 그걸로 계산만 한다.

import { BRANDING, POLICY } from '@/config/app';
import { maxScoreOf, type SubjectCode } from '@/config/subjects';
import { seoulDate, seoulMonthDay } from '@/lib/kst';

/** 접수일 기준 회신 예정일 (YYYY-MM-DD). 학생이 보는 날짜라 한국 날짜로 센다. */
export function replyDueDate(from: Date = new Date()): string {
  return seoulDate(from, POLICY.replySlaDays);
}

/** 접수번호 형식: F{MMDD}-{일련번호 3자리} (BE-2). DB 의 next_receipt_no() 와 같은 한국 날짜다. */
export function formatReceiptNo(seq: number, at: Date = new Date()): string {
  const { mm, dd } = seoulMonthDay(at);
  return `${BRANDING.receiptPrefix}${mm}${dd}-${String(seq).padStart(3, '0')}`;
}

/**
 * 적어 준 원점수가 이상하면 그 이유를, 괜찮으면 null 을 돌려준다.
 *
 * 원점수는 안 적어도 되는 칸이라 빈 값은 문제가 아니다. 문제는 적었는데 말이 안 되는
 * 경우다 — 예전에는 그대로 통과시켰다가 마지막 제출에서 서버가 거절했다. 학생은
 * 이미 다음 화면에 있어서 어느 과목의 무엇이 잘못됐는지 알 수 없었다.
 * 그래서 적는 그 화면에서 바로 막는다. 서버 검사는 그대로 두고 여기를 더한 것이다.
 */
export function scoreProblem(code: SubjectCode, raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const max = maxScoreOf(code);
  const n = Number(text);
  if (!Number.isFinite(n)) return '원점수는 숫자로 적어주세요';
  if (!Number.isInteger(n)) return '원점수는 소수점 없이 적어주세요';
  if (n < 0) return '원점수는 0점보다 작을 수 없어요';
  if (n > max) return `${max}점 만점이에요. 다시 확인해주세요.`;
  return null;
}
