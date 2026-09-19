// 문항 정오 → 점수. 순수 계산만 있고 DB 도 요청도 안 만진다.
//
// 이 파일이 따로 있는 이유: 같은 계산을 튜터 화면(채점 중 실시간 합계), 반 대시보드
// (학생 비교), 학생 화면(누적 추이), 답변 PDF 가 전부 필요로 한다. 네 군데에서 따로 더하면
// 언젠가 네 숫자가 서로 달라진다.

import {
  SECTIONS,
  SECTION_LIST,
  UNITS,
  findUnit,
  sectionOf,
  type Section,
  type UnitGroup,
} from '@/config/lms';

export type QuestionRow = {
  id: string;
  no: number;
  /** 회차를 만들 때 시험지 모양에서 베껴 둔 배점. 틀이 바뀌어도 지난 회차 점수가 안 변한다. */
  points: number;
  answer: number | null;
  unit_code: string | null;
};

export type AnswerRow = {
  question_id: string;
  correct: boolean;
  /** 학생이 적은 답. O/X 만 찍었으면 비어 있다. */
  chosen: number | null;
};

export type Tally = {
  /** 배점 합 */
  total: number;
  /** 맞은 문항 배점 합 */
  earned: number;
  /** 문항 수 */
  count: number;
  /** 맞은 문항 수 */
  correct: number;
  /** 정오를 매긴 문항 수. count 와 다르면 채점이 아직 안 끝난 것이다. */
  graded: number;
  /** 매긴 것 중 맞은 비율 0~1. 아직 안 매겼으면 0. */
  rate: number;
};

/** 점수를 쪼개 보는 한 칸. 공통/미적분 · 단원 · 배점이 모두 이 모양이다. */
export type Part = Tally & { code: string; label: string };

export type SectionPart = Part & { section: Section };
export type UnitPart = Part & { group: UnitGroup };
export type PointsPart = Part & { points: number };

export type AttemptScore = Tally & {
  /** 공통 · 미적분 */
  sections: SectionPart[];
  /** 단원을 붙인 문항만. 교과서 순서. */
  units: UnitPart[];
  /** 2점 · 3점 · 4점 */
  byPoints: PointsPart[];
  /** 단원을 안 붙인 문항 수. 단원 집계가 전체가 아니라는 것을 화면이 말할 때 쓴다. */
  untagged: number;
  /** 틀린 문항 번호 (오름차순) */
  wrongNos: number[];
  /** 문항표의 모든 문항에 정오가 매겨졌는가 */
  complete: boolean;
};

const empty = (): Tally => ({ total: 0, earned: 0, count: 0, correct: 0, graded: 0, rate: 0 });

function rateOf(t: { correct: number; graded: number }): number {
  return t.graded > 0 ? t.correct / t.graded : 0;
}

/** 문항 하나를 칸에 더한다. marked 가 없으면 '아직 안 매김' 이지 오답이 아니다. */
function add(bucket: Tally, points: number, marked: AnswerRow | undefined): void {
  bucket.total += points;
  bucket.count += 1;
  if (!marked) return;
  bucket.graded += 1;
  if (marked.correct) {
    bucket.earned += points;
    bucket.correct += 1;
  }
}

export const pointsCode = (points: number) => `p${points}`;

/** 한 학생의 한 회차. answers 에 없는 문항은 '아직 안 매김' 이지 오답이 아니다. */
export function scoreAttempt(questions: QuestionRow[], answers: AnswerRow[]): AttemptScore {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));

  const overall = empty();
  const sections = new Map<Section, SectionPart>();
  const units = new Map<string, UnitPart>();
  const points = new Map<number, PointsPart>();
  const wrongNos: number[] = [];
  let untagged = 0;

  for (const q of [...questions].sort((a, b) => a.no - b.no)) {
    const value = Number(q.points) || 0;
    const marked = byQuestion.get(q.id);

    add(overall, value, marked);
    if (marked && !marked.correct) wrongNos.push(q.no);

    const section = sectionOf(q.no);
    if (!sections.has(section)) {
      sections.set(section, { ...empty(), code: section, label: SECTIONS[section], section });
    }
    add(sections.get(section)!, value, marked);

    const unit = findUnit(q.unit_code);
    if (unit) {
      if (!units.has(unit.code)) {
        units.set(unit.code, { ...empty(), code: unit.code, label: unit.label, group: unit.group });
      }
      add(units.get(unit.code)!, value, marked);
    } else {
      untagged += 1;
    }

    if (!points.has(value)) {
      points.set(value, { ...empty(), code: pointsCode(value), label: `${value}점`, points: value });
    }
    add(points.get(value)!, value, marked);
  }

  const finish = <T extends Tally>(list: T[]): T[] => list.map((t) => ({ ...t, rate: rateOf(t) }));

  return {
    ...overall,
    rate: rateOf(overall),
    // 순서는 시험지 · 교과서 순서를 따른다. 문항표에 적힌 순서가 아니다.
    sections: finish(SECTION_LIST.map((s) => sections.get(s)).filter((s): s is SectionPart => Boolean(s))),
    units: finish(UNITS.map((u) => units.get(u.code)).filter((u): u is UnitPart => Boolean(u))),
    byPoints: finish([...points.values()].sort((a, b) => a.points - b.points)),
    untagged,
    wrongNos,
    complete: overall.count > 0 && overall.graded === overall.count,
  };
}

/* ─────────────────────────────────────────────────── 학생에게 보이는 점수 */

/**
 * 이 채점이 학생에게 보이는가 — 선생님이 매겨 저장한 채점(answers_source = tutor)이 문항을 다
 * 채웠을 때다. 따로 '공개' 를 누르는 단계는 없다 (0020). 수업이 끝나면 학생은 자기 점수를 이미
 * 알고, 이 사이트는 그 뒤의 학습 관리를 위한 곳이다.
 *
 *   · 덜 매긴 채점은 안 보인다 — 반쯤 매긴 점수는 낮은 점수로 읽힌다.
 *   · OMR 을 읽어 칸을 채운 것만으로는 채점이 아니다. 선생님이 확인하고 저장해야 한다.
 *     (0016 시절 학생 사진으로 채우고 확인하지 않은 채점은 answers_source 가 photo 라 안 보인다.)
 *
 * 회차가 '학생에게 열림' 인지는 부르는 쪽이 본다 — 닫힌 회차는 학생 화면에 아예 없다.
 * 반 평균도 이것으로 센다. 학생이 보는 평균과 선생님이 보는 평균이 달라지면 안 된다.
 */
export function scoreShown(attempt: { answers_source: string | null }, score: { complete: boolean }): boolean {
  return attempt.answers_source === 'tutor' && score.complete;
}

/* ─────────────────────────────────────────────────── 학생 사이의 비교 */

export type Standing = {
  studentId: string;
  name: string;
  score: AttemptScore;
  /** 동점은 같은 등수, 다음 등수는 건너뛴다 (1, 2, 2, 4). 채점이 안 끝났으면 0. */
  rank: number;
  /** 반 평균과의 차이 (점). 음수면 평균 아래. */
  vsAverage: number;
};

/**
 * 반 비교는 평균까지만 낸다. 한 반이 두세 명이라 최고 · 최저점은 곧 누군가의 점수다.
 */
export type CourseStats = {
  /** 채점이 끝난 응시만 센다. 반쯤 매긴 점수가 평균을 끌어내리면 안 된다. */
  counted: number;
  average: number;
  /** 칸 코드(공통 · 단원 · 배점) → 반 평균 정답률 */
  partAverages: Map<string, number>;
  standings: Standing[];
};

/** 한 점수의 모든 칸. 반 평균을 낼 때 코드로 한데 모은다. */
export function partsOf(score: AttemptScore): Part[] {
  return [...score.sections, ...score.units, ...score.byPoints];
}

/** 칸 코드마다 정답률의 평균. 매긴 문항이 없는 칸은 세지 않는다. */
export function averageRates(scores: AttemptScore[]): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const score of scores) {
    for (const part of partsOf(score)) {
      if (part.graded === 0) continue;
      acc.set(part.code, [...(acc.get(part.code) ?? []), part.rate]);
    }
  }
  return new Map([...acc].map(([code, rates]) => [code, rates.reduce((a, b) => a + b, 0) / rates.length]));
}

/**
 * 한 회차의 반 전체 성적. 채점이 끝난 응시(counted — 부르는 쪽이 scoreShown 으로 정한다)만
 * 평균·석차에 넣는다. 아직 매기는 중인 학생도 standings 에는 들어가지만 rank 가 0 이다 —
 * 화면에서 '—' 로 그린다.
 */
export function courseStats(
  entries: { studentId: string; name: string; score: AttemptScore; counted: boolean }[],
): CourseStats {
  const done = entries.filter((e) => e.counted);
  const scores = done.map((e) => e.score.earned);
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // 석차는 채점이 끝난 사람들 안에서만 매긴다.
  const sorted = [...done].sort((a, b) => b.score.earned - a.score.earned);
  const rankOf = new Map<string, number>();
  sorted.forEach((entry, i) => {
    const prev = sorted[i - 1];
    rankOf.set(
      entry.studentId,
      prev && prev.score.earned === entry.score.earned ? (rankOf.get(prev.studentId) ?? i + 1) : i + 1,
    );
  });

  const standings: Standing[] = entries
    .map((e) => ({
      studentId: e.studentId,
      name: e.name,
      score: e.score,
      rank: rankOf.get(e.studentId) ?? 0,
      vsAverage: e.counted ? e.score.earned - average : 0,
    }))
    // 채점이 끝난 사람이 위로, 그 안에서 점수 높은 순.
    .sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.name.localeCompare(b.name, 'ko'));

  return {
    counted: done.length,
    average,
    partAverages: averageRates(done.map((e) => e.score)),
    standings,
  };
}

/**
 * 학생에게 보여 줄 반 평균 (점). 채점이 끝난 학생이 둘 이상일 때만 — 혼자면 평균이 곧 자기 점수다.
 * 학생에게는 반 평균 말고는 아무것도 보이지 않는다 (최고 · 최저 · 석차 없음).
 */
export type ClassAverage = { average: number; counted: number };

export function classAverageOf(scores: AttemptScore[]): ClassAverage | null {
  if (scores.length < 2) return null;
  return { average: scores.reduce((sum, s) => sum + s.earned, 0) / scores.length, counted: scores.length };
}

/* ─────────────────────────────────────────────────── 한 학생의 누적 */

/**
 * 여러 회차를 합친 칸 하나. 문항이 적은 칸(2점은 한 회차에 3문항)은 한 문항만 틀려도
 * 33%가 되므로, 화면에서 문항 수를 같이 보여줘야 오해가 없다.
 */
export type Trend = { code: string; label: string; count: number; correct: number; graded: number; rate: number };

export type Trends = {
  sections: Trend[];
  /** 약한 순. 가장 먼저 볼 것이 맨 위에 온다. */
  units: Trend[];
  byPoints: Trend[];
};

function accumulate(lists: Part[][]): Trend[] {
  const acc = new Map<string, Trend>();
  for (const list of lists) {
    for (const p of list) {
      const cur = acc.get(p.code) ?? { code: p.code, label: p.label, count: 0, correct: 0, graded: 0, rate: 0 };
      cur.count += p.count;
      cur.correct += p.correct;
      cur.graded += p.graded;
      acc.set(p.code, cur);
    }
  }
  return [...acc.values()]
    .filter((t) => t.graded > 0)
    .map((t) => ({ ...t, rate: t.correct / t.graded }));
}

export function trendsOf(points: { score: AttemptScore }[]): Trends {
  const pointsOrder = (t: Trend) => Number(t.code.slice(1));
  return {
    sections: accumulate(points.map((p) => p.score.sections)),
    units: accumulate(points.map((p) => p.score.units)).sort((a, b) => a.rate - b.rate),
    byPoints: accumulate(points.map((p) => p.score.byPoints)).sort((a, b) => pointsOrder(a) - pointsOrder(b)),
  };
}
