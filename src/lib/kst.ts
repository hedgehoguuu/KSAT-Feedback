/**
 * 한국 시간 기준의 날짜·시각.
 *
 * Vercel 서버는 UTC 로 돈다. 그래서 `new Date().toISOString().slice(0,10)` 은
 * 한국의 새벽 0~9시 사이에 어제 날짜를 내놓는다. DB 쪽 함수들은 처음부터
 * `at time zone 'Asia/Seoul'` 로 적혀 있어서, 그냥 두면 서버와 DB 가 서로 다른
 * 날짜를 보고 회신 예정일·삭제 예정일이 하루씩 어긋난다.
 *
 * 한국은 서머타임이 없어서 하루를 밀리초로 더해도 정확하다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'Asia/Seoul';

// en-CA 는 YYYY-MM-DD 로 준다
const YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국 날짜 (YYYY-MM-DD). `plusDays` 만큼 앞뒤로 옮길 수 있다. */
export function seoulDate(from: Date = new Date(), plusDays = 0): string {
  return YMD.format(plusDays === 0 ? from : new Date(from.getTime() + plusDays * DAY_MS));
}

/** 한국 날짜의 월·일 두 자리 (접수번호 F{MMDD}-000 에 쓴다) */
export function seoulMonthDay(from: Date = new Date()): { mm: string; dd: string } {
  const [, mm, dd] = seoulDate(from).split('-');
  return { mm, dd };
}

const STAMP = new Intl.DateTimeFormat('ko-KR', {
  timeZone: ZONE,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 관리자 목록에 찍는 시각 — "9. 5. 19:30" 꼴. 한국에서 보는 사람 기준이다. */
export function seoulStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : STAMP.format(d);
}
