import { QUESTION_COUNT, parseAnswer, paperQuestion } from '@/config/lms';

/**
 * 답 여러 개를 한 줄로 받아 번호에 나눠 준다. 정답표를 옮겨 적거나, 학생 답안을 불러 주며
 * 30칸을 하나씩 누르는 대신 한 번에 친다.
 *
 *   "3 5 2 4 1 2 3 5 1 4 3 2 5 4 1 12 7 24 5 31 17 58 2 4 1 3 5 2 16 125"
 *
 *   · 띄어쓰기 · 쉼표 · 줄바꿈 무엇으로 나눠도 된다. ①–⑤ 도 받는다.
 *   · 비운 문항(학생이 안 쓴 답)은 `-` 나 `.` 로 자리만 채운다. `--` 는 두 칸이다.
 *   · 5지선다 자리에서는 붙여 써도 된다 — "35241" 은 다섯 문항이다. 단답형 자리에서는
 *     붙여 쓴 숫자를 한 수로 읽는다(자릿수로 나눌 방법이 없다).
 *
 * 브라우저에서 돈다. 틀린 칸을 버리지 않고 `invalid` 로 따로 돌려준다 — 조용히 비우면
 * 그 뒤로 번호가 한 칸씩 밀린 줄도 모른다.
 */
export type LineResult = {
  /** 번호 → 답. null 은 '비움' 으로 적은 칸이다. */
  values: Map<number, number | null>;
  /** 그 번호에 올 수 없는 값이 적힌 번호 → 적힌 글자. 칸에 그대로 남겨 빨갛게 보이게 한다. */
  invalid: Map<number, string>;
  /** 30번을 넘어 남은 값의 수 */
  overflow: number;
};

const BLANK = /^[-.·_]+$/;

export function parseAnswerLine(line: string, startNo = 1): LineResult {
  const values = new Map<number, number | null>();
  const invalid = new Map<number, string>();
  let overflow = 0;
  let no = startNo;

  const tokens = line
    .replace(/[①②③④⑤]/g, (c) => ` ${'①②③④⑤'.indexOf(c) + 1} `)
    .split(/[\s,/]+/)
    .filter(Boolean);

  for (const token of tokens) {
    if (BLANK.test(token)) {
      for (let i = 0; i < token.length; i += 1) {
        if (no > QUESTION_COUNT) overflow += 1;
        else values.set(no, null);
        no += 1;
      }
      continue;
    }

    if (no > QUESTION_COUNT) {
      overflow += 1;
      continue;
    }

    // 5지선다 자리에 붙여 쓴 숫자 — 단답형 자리에 닿을 때까지 한 자리씩 나눈다.
    if (paperQuestion(no)?.kind === 'choice' && /^[1-5]{2,}$/.test(token)) {
      const digits = Array.from(token);
      while (digits.length > 0 && no <= QUESTION_COUNT && paperQuestion(no)?.kind === 'choice') {
        values.set(no, Number(digits.shift()));
        no += 1;
      }
      if (digits.length > 0) {
        if (no > QUESTION_COUNT) {
          overflow += digits.length;
        } else {
          // 남은 자리를 단답형 한 칸의 답으로 읽으면 번호가 조용히 밀린다. 틀린 칸으로 짚는다.
          invalid.set(no, digits.join(''));
          values.set(no, null);
          no += 1;
        }
      }
      continue;
    }

    const value = parseAnswer(no, token);
    if (value === null) invalid.set(no, token);
    values.set(no, value);
    no += 1;
  }

  return { values, invalid, overflow };
}
