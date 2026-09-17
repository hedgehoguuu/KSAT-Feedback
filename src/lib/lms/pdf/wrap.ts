/**
 * 글을 폭에 맞춰 줄로 나눈다. PDF 는 줄바꿈을 해 주지 않아서 직접 한다.
 *
 * 한국어는 어절(띄어쓰기) 단위로 넘긴다 — 사이트의 `word-break: keep-all` 과 같은 결이다.
 * 한 어절이 한 줄보다 길 때만(주소, 긴 수식) 글자 단위로 자른다.
 * 줄바꿈은 그대로 살리고, 빈 줄은 빈 줄로 남긴다. 연달아 친 공백은 하나로 본다.
 *
 * 폭을 재는 방법(measure)을 밖에서 받는다. 그래서 폰트 없이도 시험할 수 있다.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) out.push(line);
      line = '';

      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }

      // 한 줄에 안 들어가는 어절. 글자 단위로 채운다 (Array.from 이라 한글 · 기호가 안 쪼개진다).
      for (const ch of Array.from(word)) {
        if (line && measure(line + ch) > maxWidth) {
          out.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
    }
    out.push(line);
  }

  // 끝에 붙은 빈 줄은 여백만 먹는다.
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** 폭을 넘으면 뒤를 줄이고 말줄임표를 붙인다. 바닥글처럼 한 줄에 들어가야 하는 곳에 쓴다. */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && measure(`${chars.join('')}…`) > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}
