// 문항 정오 → 영역별 점수. 순수 계산만 있고 DB 도 요청도 안 만진다.
//
// 이 파일이 따로 있는 이유: 같은 계산을 튜터 화면(채점 중 실시간 합계), 반 대시보드
// (학생 비교), 학생 화면(누적 추이)이 전부 필요로 한다. 세 군데에서 따로 더하면
// 언젠가 세 숫자가 서로 달라진다.

import { AREAS, AREA_GROUPS, type AreaGroup, type Elective } from '@/config/lms';

export type QuestionRow = {
  id: string;
  no: number;
  area_code: string;
  points: number;
  answer: number | null;
  passage: string | null;
};

export type AnswerRow = {
  question_id: string;
  correct: boolean;
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

export type AreaTally = Tally & { code: string; label: string; group: AreaGroup };
export type GroupTally = Tally & { group: AreaGroup; label: string; areas: AreaTally[] };

export type AttemptScore = Tally & {
  areas: AreaTally[];
  groups: GroupTally[];
  /** 틀린 문항 번호 (오름차순) */
  wrongNos: number[];
  /** 문항표의 모든 문항에 정오가 매겨졌는가 */
  complete: boolean;
};

const EMPTY: Tally = { total: 0, earned: 0, count: 0, correct: 0, graded: 0, rate: 0 };

function rateOf(t: { correct: number; graded: number }): number {
  return t.graded > 0 ? t.correct / t.graded : 0;
}

/**
 * 이 학생이 풀어야 하는 문항만 남긴다.
 *
 * 선택과목이 다른 문항은 '틀린' 게 아니라 '없는' 문항이다. 화작 학생의 만점을
 * 언매 11문항까지 넣어 세면 100점을 받아도 78점으로 보인다.
 * 선택과목을 아직 안 정한 학생은 공통(독서·문학)만 센다.
 */
export function questionsFor(questions: QuestionRow[], elective: Elective | null): QuestionRow[] {
  const mine = new Set(
    AREAS.filter((a) => !a.elective || a.elective === elective).map((a) => a.code),
  );
  return questions.filter((q) => mine.has(q.area_code));
}

/** 한 학생의 한 회차. answers 에 없는 문항은 '아직 안 매김' 이지 오답이 아니다. */
export function scoreAttempt(
  questions: QuestionRow[],
  answers: AnswerRow[],
  elective: Elective | null,
): AttemptScore {
  const mine = questionsFor(questions, elective);
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));

  const areaMap = new Map<string, AreaTally>();
  const wrongNos: number[] = [];
  const overall: Tally = { ...EMPTY };

  for (const q of mine) {
    const area = AREAS.find((a) => a.code === q.area_code);
    let bucket = areaMap.get(q.area_code);
    if (!bucket) {
      bucket = {
        ...EMPTY,
        code: q.area_code,
        label: area?.label ?? q.area_code,
        group: area?.group ?? 'reading',
      };
      areaMap.set(q.area_code, bucket);
    }

    const points = Number(q.points) || 0;
    bucket.total += points;
    bucket.count += 1;
    overall.total += points;
    overall.count += 1;

    const marked = byQuestion.get(q.id);
    if (!marked) continue;

    bucket.graded += 1;
    overall.graded += 1;
    if (marked.correct) {
      bucket.earned += points;
      bucket.correct += 1;
      overall.earned += points;
      overall.correct += 1;
    } else {
      wrongNos.push(q.no);
    }
  }

  // 영역 순서는 AREAS 순서(시험지에 나오는 순서)를 따른다. 문항표 입력 순서가 아니다.
  const areas = AREAS.map((a) => areaMap.get(a.code)).filter((a): a is AreaTally => Boolean(a));
  for (const a of areas) a.rate = rateOf(a);
  overall.rate = rateOf(overall);

  const groups: GroupTally[] = (Object.keys(AREA_GROUPS) as AreaGroup[])
    .map((group) => {
      const inGroup = areas.filter((a) => a.group === group);
      const sum = inGroup.reduce<Tally>(
        (acc, a) => ({
          total: acc.total + a.total,
          earned: acc.earned + a.earned,
          count: acc.count + a.count,
          correct: acc.correct + a.correct,
          graded: acc.graded + a.graded,
          rate: 0,
        }),
        { ...EMPTY },
      );
      return { ...sum, rate: rateOf(sum), group, label: AREA_GROUPS[group], areas: inGroup };
    })
    .filter((g) => g.areas.length > 0);

  return {
    ...overall,
    areas,
    groups,
    wrongNos: wrongNos.sort((a, b) => a - b),
    complete: overall.count > 0 && overall.graded === overall.count,
  };
}

/* ─────────────────────────────────────────────────── 학생 사이의 비교 */

export type Standing = {
  studentId: string;
  name: string;
  score: AttemptScore;
  /** 동점은 같은 등수, 다음 등수는 건너뛴다 (1, 2, 2, 4). */
  rank: number;
  /** 반 평균과의 차이 (점). 음수면 평균 아래. */
  vsAverage: number;
};

export type CourseStats = {
  /** 채점이 끝난 응시만 센다. 반쯤 매긴 점수가 평균을 끌어내리면 안 된다. */
  counted: number;
  average: number;
  highest: number;
  lowest: number;
  /** 영역 코드 → 반 평균 정답률 */
  areaAverages: Map<string, number>;
  standings: Standing[];
};

/**
 * 한 회차의 반 전체 성적. 채점이 끝난(complete) 응시만 평균·석차에 넣는다.
 * 아직 매기는 중인 학생도 standings 에는 들어가지만 rank 가 0 이다 — 화면에서 '—' 로 그린다.
 */
export function courseStats(
  entries: { studentId: string; name: string; score: AttemptScore }[],
): CourseStats {
  const done = entries.filter((e) => e.score.complete);
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

  const areaAverages = new Map<string, number>();
  for (const area of AREAS) {
    const rates = done
      .map((e) => e.score.areas.find((a) => a.code === area.code))
      .filter((a): a is AreaTally => Boolean(a) && a!.graded > 0)
      .map((a) => a.rate);
    if (rates.length) areaAverages.set(area.code, rates.reduce((a, b) => a + b, 0) / rates.length);
  }

  const standings: Standing[] = entries
    .map((e) => ({
      studentId: e.studentId,
      name: e.name,
      score: e.score,
      rank: rankOf.get(e.studentId) ?? 0,
      vsAverage: e.score.complete ? e.score.earned - average : 0,
    }))
    // 채점이 끝난 사람이 위로, 그 안에서 점수 높은 순.
    .sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.name.localeCompare(b.name, 'ko'));

  return {
    counted: done.length,
    average,
    highest: scores.length ? Math.max(...scores) : 0,
    lowest: scores.length ? Math.min(...scores) : 0,
    areaAverages,
    standings,
  };
}

/* ─────────────────────────────────────────────────── 한 학생의 누적 */

export type TrendPoint = {
  attemptId: string;
  examTitle: string;
  examDate: string | null;
  earned: number;
  total: number;
  rate: number;
  areaRates: Map<string, number>;
};

/**
 * 영역별 강약. 누적된 회차 전체에서 정답률이 낮은 순으로 준다.
 * 문항이 적은 영역(독서론 3문항)은 한 문항만 틀려도 33%가 되므로,
 * 화면에서 문항 수를 같이 보여줘야 오해가 없다.
 */
export type AreaTrend = {
  code: string;
  label: string;
  group: AreaGroup;
  count: number;
  correct: number;
  graded: number;
  rate: number;
};

export function areaTrends(points: { score: AttemptScore }[]): AreaTrend[] {
  const acc = new Map<string, AreaTrend>();
  for (const p of points) {
    for (const a of p.score.areas) {
      const cur = acc.get(a.code) ?? {
        code: a.code,
        label: a.label,
        group: a.group,
        count: 0,
        correct: 0,
        graded: 0,
        rate: 0,
      };
      cur.count += a.count;
      cur.correct += a.correct;
      cur.graded += a.graded;
      acc.set(a.code, cur);
    }
  }
  const out = [...acc.values()].filter((a) => a.graded > 0);
  for (const a of out) a.rate = a.correct / a.graded;
  return out.sort((a, b) => a.rate - b.rate);
}
