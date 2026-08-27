// 이메일 형식 검사 + 흔한 오타 도메인 제안 (FE-6)

const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** 국내 학생이 실제로 많이 쓰는 순서 */
const KNOWN_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'kakao.com',
  'nate.com',
  'icloud.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
];

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && SHAPE.test(v);
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return prev[b.length];
}

/**
 * 오타로 보이는 도메인이면 고친 주소를 돌려준다. 확신이 없으면 null.
 * `gmail.con` → `gmail.com`, `naver.cin` → `naver.com`
 */
export function suggestEmail(value: string): string | null {
  const v = value.trim();
  const at = v.lastIndexOf('@');
  if (at < 1) return null;

  const local = v.slice(0, at);
  const domain = v.slice(at + 1).toLowerCase();
  if (!domain || KNOWN_DOMAINS.includes(domain)) return null;

  let best: { domain: string; d: number } | null = null;
  for (const known of KNOWN_DOMAINS) {
    const d = distance(domain, known);
    if (d > 0 && d <= 2 && (!best || d < best.d)) best = { domain: known, d };
  }
  if (!best) return null;

  // 학교·회사 도메인을 함부로 고치자고 하지 않도록, 앞부분(naver/gmail)이 같을 때만 제안한다
  const head = (s: string) => s.split('.')[0];
  const sameHead = head(domain) === head(best.domain);
  const oneOff = best.d === 1;
  if (!sameHead && !oneOff) return null;

  return `${local}@${best.domain}`;
}
