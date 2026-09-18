// 숫자 · 날짜 서식. 화면 · PDF · CSV · 메일이 같은 모양으로 적게 한곳에 둔다.
// 순수 함수라 브라우저 부품과 서버가 같이 부른다.

/** 498000 → "498,000원" */
export function won(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

/** 78.5 → "78.5", 78 → "78". 점수는 소수 첫째 자리까지만 보여준다. */
export function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 0.8235 → "82%" */
export function fmtRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "2026-09-24" → "9월 24일". 달력 날짜만 다루므로 시차를 타지 않는다. */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : date;
}

/** "2026-09-17" + 7 → "2026-09-24". 달력 계산이라 UTC 로 센다(시각이 없으니 어긋날 일이 없다). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
