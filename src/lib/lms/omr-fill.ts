import type { ReadAnswer } from './ocr-rows';
import { parseAnswer } from './paper';
import type { QuestionRow } from './score';

/**
 * OMR 에서 읽은 답을 채점표 칸에 채운다. 순수 계산이라 화면(GradeSheet)과 시험이 같이 쓴다.
 *
 * 채우기만 하고 저장하지 않는다 — 선생님이 칸을 보고 저장을 눌러야 채점이 된다. 그래서 여기서
 * 정하는 것은 '어느 칸을 채우고 어느 칸은 사람에게 넘기는가' 하나다.
 *
 *   · 확실히 읽힌 답은 학생 답 칸에 넣고, 정답과 맞춰 O/X 를 찍는다.
 *   · 확실한 빈칸은 틀림이다 — 한 줄 넣기의 '-' 와 같다.
 *   · 정답이 아직 없는 문항은 학생 답만 넣고 O/X 는 선생님에게 둔다.
 *   · 애매하게 읽힌 문항(둘 다 마킹 · 흐림 · 숫자와 마킹이 다름 · 못 찾음)은 칸을 건드리지 않고
 *     읽힌 값을 옆에 붙인다(hints). 화면이 노랗게 두르고 '넣기' 를 준다. 둘 중 하나를 골라
 *     채우면 틀린 쪽을 고른 날 조용히 틀린 채점이 된다.
 */

export type Mark = '' | 'o' | 'x';

/** 채점표 칸의 지금 값. 문항 id → 학생 답(입력 그대로) · 정오 */
export type SheetState = { chosen: Record<string, string>; marks: Record<string, Mark> };

export type OmrFill = SheetState & {
  /** 문항 id → 확인할 문항의 읽은 값 */
  hints: Record<string, ReadAnswer>;
  /** 확실히 읽혀 칸에 넣은 문항 수 (빈칸 포함) */
  filled: number;
  /** 사람이 확인해야 하는 번호. 칸은 그대로 뒀다. */
  check: number[];
  /** 확실한 빈칸이라 틀림으로 매긴 번호 */
  blanks: number[];
  /** 이미 매겨 둔 정오와 달라진 번호 — 다시 읽혔을 때 무엇이 바뀌었는지 짚는다 */
  changed: number[];
  /** 정답이 비어 있어 학생 답만 넣고 O/X 는 비운 번호 */
  unkeyed: number[];
};

export function fillFromOmr(questions: QuestionRow[], reads: ReadAnswer[], current: SheetState): OmrFill {
  const byNo = new Map(reads.map((r) => [r.no, r]));
  const out: OmrFill = {
    chosen: { ...current.chosen },
    marks: { ...current.marks },
    hints: {},
    filled: 0,
    check: [],
    blanks: [],
    changed: [],
    unkeyed: [],
  };

  for (const q of [...questions].sort((a, b) => a.no - b.no)) {
    const read = byNo.get(q.no);
    if (!read) continue;

    if (!read.sure) {
      out.hints[q.id] = read;
      out.check.push(q.no);
      continue;
    }

    const before: Mark = current.marks[q.id] ?? '';
    const typed = parseAnswer(q.no, current.chosen[q.id] ?? '');
    let mark: Mark;
    if (read.answer === null) {
      mark = 'x';
      out.blanks.push(q.no);
    } else if (q.answer !== null) {
      mark = read.answer === q.answer ? 'o' : 'x';
    } else {
      // 정답이 없으면 매길 수 없다. 전에 같은 답으로 매겨 둔 것만 남긴다.
      mark = typed === read.answer ? before : '';
      out.unkeyed.push(q.no);
    }

    out.chosen[q.id] = read.answer === null ? '' : String(read.answer);
    out.marks[q.id] = mark;
    out.filled += 1;
    if (before !== '' && before !== mark) out.changed.push(q.no);
  }

  return out;
}
