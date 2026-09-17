/**
 * DB 없이 도는 시험. `npm test` 가 이걸 돌린다.
 *
 * 여기 있는 것은 전부 순수 계산이라 늘 돌릴 수 있고 몇 초면 끝난다.
 * 점수를 어떻게 세는가 · 답을 어떻게 읽는가 · 사진에서 온 것을 어떻게 거르는가 ·
 * 답변 PDF 가 제대로 만들어지는가 — 틀리면 사람이 손해를 보는데, 화면만 봐서는
 * 틀린 줄 모르는 것들이다.
 */
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  CONCERN,
  FULL_SCORE,
  LMS,
  PAPER,
  QUESTION_COUNT,
  addDays,
  concernOrder,
  concernTopic,
  fmtAnswer,
  fmtDay,
  fmtRate,
  fmtScore,
  isValidAnswer,
  loginIdProblem,
  paperQuestion,
  paperSummary,
  parseAnswer,
  passwordProblem,
  sectionFull,
  unitFits,
  unitLabel,
  unitsFor,
} from '../src/config/lms.ts';
import { hashPassword, verifyPassword } from '../src/lib/lms/password.ts';
import { normalizeExtracted } from '../src/lib/lms/ocr-rows.ts';
import { parseAnswerLine } from '../src/lib/lms/answer-line.ts';
import { courseStats, scoreAttempt, trendsOf, type AnswerRow, type QuestionRow } from '../src/lib/lms/score.ts';
import { cleanConcerns, progressOf } from '../src/lib/lms/feedback.ts';
import { renderFeedbackPdf, type FeedbackDoc } from '../src/lib/lms/pdf/feedback-pdf.ts';
import { fitText, wrapText } from '../src/lib/lms/pdf/wrap.ts';
import { inChunks } from '../src/lib/lms/db.ts';
import { done, eq, ok, section } from './assert.ts';

/* ────────────────────────────────────────────────── 시험지 모양 */

section('시험지 모양 — 수능 수학 (공통 + 미적분)');
eq('30문항', PAPER.length, 30);
eq('만점 100', FULL_SCORE, 100);
eq('공통 74점', sectionFull('common'), 74);
eq('미적분 26점', sectionFull('calculus'), 26);
eq('2점은 1 · 2 · 23번', PAPER.filter((q) => q.points === 2).map((q) => q.no), [1, 2, 23]);
eq('4점은 9–15 · 20–22 · 28–30번',
  PAPER.filter((q) => q.points === 4).map((q) => q.no), [9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 28, 29, 30]);
eq('단답형은 16–22 · 29–30번',
  PAPER.filter((q) => q.kind === 'short').map((q) => q.no), [16, 17, 18, 19, 20, 21, 22, 29, 30]);
eq('22번까지 공통', paperQuestion(22)?.section, 'common');
eq('23번부터 미적분', paperQuestion(23)?.section, 'calculus');
eq('안내 문구를 표에서 만든다', paperSummary(), '1–22 공통 · 23–30 미적분');
ok('0번 · 31번 · 1.5번은 없는 문항', !paperQuestion(0) && !paperQuestion(31) && !paperQuestion(1.5));

section('단원 — 번호에 맞는 것만');
ok('공통 문항에는 수학Ⅰ·Ⅱ 단원만', unitsFor(22).every((u) => u.group !== 'calculus') && unitsFor(22).length === 6);
ok('미적분 문항에는 미적분 단원만', unitsFor(23).every((u) => u.group === 'calculus') && unitsFor(23).length === 3);
ok('23번에 삼각함수는 안 맞는다', !unitFits(23, 'm1_trig'));
ok('5번에 미분법(미적분)은 안 맞는다', !unitFits(5, 'c_diff'));
ok('모르는 코드도 안 맞는다', !unitFits(5, 'read_theory'));
eq('단원 이름', unitLabel('c_seqlim'), '수열의 극한');
eq('단원이 없으면', unitLabel(null), '단원 미정');

/* ────────────────────────────────────────────────── 답 읽기 */

section('답 읽기 — 번호마다 받는 답이 다르다');
eq('5지선다 3', parseAnswer(1, '3'), 3);
eq('5지선다에 6은 안 된다', parseAnswer(1, '6'), null);
eq('5지선다에 0도 안 된다', parseAnswer(1, '0'), null);
eq('동그라미 숫자도 받는다', parseAnswer(7, '④'), 4);
eq("'3번' 도 받는다", parseAnswer(7, '3번'), 3);
eq('단답형 999', parseAnswer(16, '999'), 999);
eq('단답형 0', parseAnswer(16, '0'), 0);
eq('단답형 1000 은 안 된다', parseAnswer(16, '1000'), null);
eq('음수는 안 된다', parseAnswer(16, '-3'), null);
eq('소수는 안 된다', parseAnswer(16, '2.5'), null);
eq('빈 칸은 답이 없는 것', parseAnswer(16, '  '), null);
ok('isValidAnswer 는 정수만', isValidAnswer(30, 125) && !isValidAnswer(30, 12.5) && !isValidAnswer(30, '12'));
eq('5지선다는 동그라미로 적는다', fmtAnswer(3, 2), '②');
eq('단답형은 숫자 그대로', fmtAnswer(29, 2), '2');
eq('없으면 줄표', fmtAnswer(29, null), '—');

section('한 줄로 넣기');
const full = parseAnswerLine('3 5 2 4 1 2 3 5 1 4 3 2 5 4 1 12 7 24 5 31 17 58 2 4 1 3 5 2 16 125');
eq('30개가 번호대로 들어간다', [...full.values.keys()], PAPER.map((q) => q.no));
eq('30번은 125', full.values.get(30), 125);
ok('틀린 칸이 없다', full.invalid.size === 0 && full.overflow === 0);
const packed = parseAnswerLine('352412351432541 12,7');
eq('5지선다는 붙여 써도 나눈다', [...packed.values.values()].slice(0, 15), [3, 5, 2, 4, 1, 2, 3, 5, 1, 4, 3, 2, 5, 4, 1]);
eq('쉼표로 나눠도 된다', [packed.values.get(16), packed.values.get(17)], [12, 7]);
const blanks = parseAnswerLine('3 - 2 -- 5');
eq("'-' 는 빈 칸 하나, '--' 는 둘", [...blanks.values.entries()], [[1, 3], [2, null], [3, 2], [4, null], [5, null], [6, 5]]);
const crossing = parseAnswerLine('1 1 1 1 1 1 1 1 1 1 1 1 1 3524');
eq('붙여 쓴 숫자가 단답형 자리에 닿으면', [crossing.values.get(14), crossing.values.get(15)], [3, 5]);
eq('남은 자리는 틀린 칸으로 짚는다 (번호가 밀리지 않게)', [...crossing.invalid.entries()], [[16, '24']]);
const wrong = parseAnswerLine('7 3');
eq('5지선다에 7 → 틀린 칸', [...wrong.invalid.entries()], [[1, '7']]);
eq('틀린 칸 뒤도 번호가 이어진다', wrong.values.get(2), 3);
eq('30개를 넘으면 버린 수를 센다', parseAnswerLine(`${'1 '.repeat(15)}${'5 '.repeat(15)}9 9`).overflow, 2);
eq('중간 번호부터 시작할 수 있다', [...parseAnswerLine('7 8', 16).values.keys()], [16, 17]);
eq('동그라미를 붙여 써도 나눈다', [...parseAnswerLine('③④').values.values()], [3, 4]);

/* ────────────────────────────────────────────────── 채점 */

const KEY = [3, 5, 2, 4, 1, 2, 3, 5, 1, 4, 3, 2, 5, 4, 1, 12, 7, 24, 5, 31, 17, 58, 2, 4, 1, 3, 5, 2, 16, 125];
const UNITS_BY_NO: Record<number, string> = { 1: 'm1_explog', 9: 'm1_trig', 12: 'm1_seq', 21: 'm2_diff', 23: 'c_seqlim', 28: 'c_diff', 30: 'c_integ' };
const paper: QuestionRow[] = PAPER.map((p) => ({
  id: `q${p.no}`,
  no: p.no,
  points: p.points,
  answer: KEY[p.no - 1],
  unit_code: UNITS_BY_NO[p.no] ?? null,
}));
const allRight: AnswerRow[] = paper.map((q) => ({ question_id: q.id, correct: true, chosen: q.answer }));
const wrongAt = (...nos: number[]): AnswerRow[] =>
  paper.map((q) => ({ question_id: q.id, correct: !nos.includes(q.no), chosen: q.answer }));

section('점수');
const perfect = scoreAttempt(paper, allRight);
eq('다 맞으면 100', perfect.earned, 100);
eq('공통 74 · 미적분 26', perfect.sections.map((s) => [s.label, s.earned, s.total]), [['공통', 74, 74], ['미적분', 26, 26]]);
ok('채점 끝', perfect.complete);
const mixed = scoreAttempt(paper, wrongAt(12, 15, 21, 30));
eq('4점 네 개 틀리면 84', mixed.earned, 84);
eq('틀린 문항 오름차순', mixed.wrongNos, [12, 15, 21, 30]);
eq('공통 62 · 미적분 22', mixed.sections.map((s) => s.earned), [62, 22]);
eq('배점별 칸은 2 · 3 · 4점 순', mixed.byPoints.map((p) => p.label), ['2점', '3점', '4점']);
eq('4점 13문항 중 9개', [mixed.byPoints[2].correct, mixed.byPoints[2].count], [9, 13]);
eq('단원은 붙인 문항만 센다', mixed.units.map((u) => u.code), ['m1_explog', 'm1_trig', 'm1_seq', 'm2_diff', 'c_seqlim', 'c_diff', 'c_integ']);
eq('단원 안 붙인 문항 수', mixed.untagged, 23);
eq('수열(12번) 0/1', [mixed.units.find((u) => u.code === 'm1_seq')?.correct, mixed.units.find((u) => u.code === 'm1_seq')?.graded], [0, 1]);
ok('문항표가 뒤섞여 와도 번호순으로 센다', scoreAttempt([...paper].reverse(), wrongAt(30, 12)).wrongNos.join() === '12,30');

section('안 매긴 문항은 오답이 아니다');
const half = scoreAttempt(paper, allRight.slice(0, 10));
eq('매긴 것만 득점', half.earned, 2 + 2 + 3 * 6 + 4 * 2);
eq('만점은 그대로', half.total, 100);
ok('채점이 안 끝난 것으로 잡힌다', !half.complete);
eq('정답률은 매긴 것 기준', half.rate, 1);
ok('아무것도 안 매기면 미완료', !scoreAttempt(paper, []).complete);
ok('문항표가 비면 미완료', !scoreAttempt([], []).complete);

section('배점은 문항표에 적힌 것을 쓴다 (지난 회차가 안 바뀌게)');
const oldPaper = paper.map((q) => (q.no === 1 ? { ...q, points: 3 } : q));
eq('예전 배점 3점짜리 1번', scoreAttempt(oldPaper, allRight).total, 101);

/* ────────────────────────────────────────────────── 반 비교 */

section('석차와 반 평균');
const stats = courseStats([
  { studentId: 'a', name: '가', score: perfect },
  { studentId: 'b', name: '나', score: mixed },
  { studentId: 'c', name: '다', score: scoreAttempt(paper, wrongAt(9, 10, 11, 12)) },
  { studentId: 'd', name: '라', score: half },
]);
eq('채점 끝난 사람만 센다', stats.counted, 3);
eq('동점은 같은 등수, 다음은 건너뛴다', stats.standings.map((s) => s.rank), [1, 2, 2, 0]);
eq('평균 (100 + 84 + 84) / 3', Math.round(stats.average * 10) / 10, 89.3);
eq('미채점자는 평균 대비 0', stats.standings.find((s) => s.studentId === 'd')?.vsAverage, 0);
ok('최고·최저', stats.highest === 100 && stats.lowest === 84);
ok('칸마다 반 평균 정답률 (공통 · 배점 · 단원)',
  ['common', 'calculus', 'p2', 'p3', 'p4', 'm1_seq'].every((c) => stats.partAverages.has(c)));
eq('수열 반 평균 = (1 + 0 + 0) / 3', Math.round((stats.partAverages.get('m1_seq') ?? 0) * 100), 33);

section('누적');
const trends = trendsOf([{ score: mixed }, { score: perfect }]);
eq('단원은 약한 순', trends.units[0].rate <= trends.units[trends.units.length - 1].rate, true);
eq('회차가 합산된다', trends.byPoints.find((t) => t.code === 'p4')?.graded, 26);
eq('배점 칸은 점수 순', trends.byPoints.map((t) => t.code), ['p2', 'p3', 'p4']);
eq('매긴 게 없는 칸은 빠진다', trendsOf([{ score: scoreAttempt(paper, []) }]).units.length, 0);

/* ────────────────────────────────────────────────── 비밀번호 */

section('비밀번호');
const stored = hashPassword('correct horse battery');
ok('맞는 비밀번호는 통과', verifyPassword('correct horse battery', stored));
ok('틀리면 거절', !verifyPassword('correct horse batteryX', stored));
ok('빈 값도 거절', !verifyPassword('', stored));
ok('해시가 없으면 거절', !verifyPassword('x', null));
ok('같은 비밀번호도 해시는 매번 다르다 (소금)', hashPassword('a') !== hashPassword('a'));
ok('형식이 깨져도 던지지 않고 거절', !verifyPassword('x', 'garbage'));
ok('버전이 다르면 거절', !verifyPassword('x', 's9.aa.bb'));
ok('없는 아이디용 더미 해시가 예외를 안 던진다', !verifyPassword('any', `s1.00.${'0'.repeat(128)}`));

section('아이디와 비밀번호 규칙');
// 대문자는 막지 않고 소문자로 내려서 받는다. 막으면 튜터가 'Boss' 라고 적었을 때
// 이유 없이 튕기는데, 어차피 저장도 조회도 소문자라 그냥 받는 편이 맞다 (0009).
ok('대문자로 적어도 받는다 (소문자로 내려 저장)', loginIdProblem('Boss') === null);
ok('한글 아이디는 거절', loginIdProblem('주현') !== null);
ok('세 글자는 거절', loginIdProblem('abc') !== null);
ok('영문 소문자·숫자·(. _ -) 는 통과', loginIdProblem('kim.seo_1-a') === null);
ok(`${LMS.minPasswordLength}자 미만은 거절`, passwordProblem('a'.repeat(LMS.minPasswordLength - 1)) !== null);
ok(`${LMS.minPasswordLength}자는 통과`, passwordProblem('a'.repeat(LMS.minPasswordLength)) === null);

/* ────────────────────────────────────────────────── 사진에서 읽은 정답표 */

section('사진에서 온 정답 거르기 — 지어낸 값이 저장되면 안 된다');
const raw = (no: number, answer: number | null, unit_code: string | null = null) => ({ no, answer, unit_code });
const read = normalizeExtracted([raw(1, 3), raw(16, 12), raw(29, 7), raw(30, 125)]);
eq('읽은 정답은 그대로', read.rows.map((r) => r.answer), [3, 12, 7, 125]);
eq('못 읽은 번호를 알려 준다', read.unread.length, QUESTION_COUNT - 4);
eq('0번 · 31번 · 1.5번은 버린다', normalizeExtracted([raw(0, 1), raw(31, 1), raw(1.5, 1)]).rows.length, 0);
eq('5지선다에 6이면 비운다', normalizeExtracted([raw(2, 6)]).rows[0].answer, null);
eq('단답형 1000 이면 비운다', normalizeExtracted([raw(17, 1000)]).rows[0].answer, null);
eq('같은 번호 · 같은 답은 하나로', normalizeExtracted([raw(3, 2), raw(3, 2)]).rows.length, 1);
const clash = normalizeExtracted([raw(21, 17), raw(21, 71)]);
eq('같은 번호에 다른 답이면 비운다', clash.rows[0].answer, null);
eq('그 번호를 짚는다', clash.conflicts, [21]);
eq('하나가 흐리면 읽힌 쪽을 쓴다', normalizeExtracted([raw(4, null), raw(4, 5)]).rows[0].answer, 5);
eq('번호에 맞는 단원은 받는다', normalizeExtracted([raw(23, 2, 'c_seqlim')]).rows[0].unit_code, 'c_seqlim');
eq('23번에 수학Ⅰ 단원은 버린다', normalizeExtracted([raw(23, 2, 'm1_trig')]).rows[0].unit_code, null);
eq('국어 영역 코드도 버린다', normalizeExtracted([raw(1, 2, 'read_theory')]).rows[0].unit_code, null);
eq('번호 오름차순', normalizeExtracted([raw(30, 1), raw(2, 1)]).rows.map((r) => r.no), [2, 30]);

/* ────────────────────────────────────────────────── 학생 질문 */

section('학생 질문 거르기');
const cleaned = cleanConcerns([
  { question_no: 21, body: '  그래프 개형  ' },
  { question_no: 0, body: '시간 배분' },
  { question_no: 21, body: '절댓값' },
  { question_no: 5, body: '   ' },
  { question_no: 12, body: '수열' },
]);
eq('문제 없음', cleaned.problem, null);
eq('빈 질문은 뺀다', cleaned.drafts.some((d) => d.question_no === 5), false);
eq('같은 문항은 한 질문으로 합친다', cleaned.drafts.find((d) => d.question_no === 21)?.body, '그래프 개형\n\n절댓값');
eq("문항 순서대로, '시험 전체' 는 맨 뒤", cleaned.drafts.map((d) => d.question_no), [12, 21, 0]);
eq('없는 번호에 적으면 버리지 않고 알린다', cleanConcerns([{ question_no: 31, body: 'x' }]).problem, 'NO');
eq('번호를 안 고르고 적어도 알린다', cleanConcerns([{ question_no: Number.NaN, body: 'x' }]).problem, 'NO');
eq('너무 길면 알린다', cleanConcerns([{ question_no: 1, body: '가'.repeat(CONCERN.maxBody + 1) }]).problem, 'LONG');
eq('이모지는 한 글자로 센다 (DB 와 같게)',
  cleanConcerns([{ question_no: 1, body: '😭'.repeat(CONCERN.maxBody) }]).problem, null);
eq('글이든 사진이든 답이 있으면 단 것',
  progressOf([
    { question_no: 3, answer: '답', answer_image_path: null },
    { question_no: 7, answer: null, answer_image_path: 'a.jpg' },
    { question_no: 0, answer: '   ', answer_image_path: null },
  ]),
  { total: 3, answered: 2, missing: [0] });

/* ────────────────────────────────────────────────── 화면에 찍히는 값 */

section('표기');
eq('정수는 소수점 없이', fmtScore(78), '78');
eq('소수는 첫째 자리까지', fmtScore(78.25), '78.3');
eq('비율은 반올림 퍼센트', fmtRate(0.8235), '82%');
eq('날짜는 월 · 일', fmtDay('2026-09-24'), '9월 24일');
eq('기한 기본값은 일주일 뒤', addDays('2026-09-28', 7), '2026-10-05');
eq('해를 넘겨도', addDays('2026-12-29', 7), '2027-01-05');
eq('0번은 시험 전체', concernTopic(0), '시험 전체');
eq('질문 순서', [0, 30, 2].sort(concernOrder), [2, 30, 0]);

/* ────────────────────────────────────────────────── 답변 PDF */

section('줄 나누기');
const width = (s: string) => Array.from(s).length; // 한 글자 = 1
eq('어절 단위로 넘긴다', wrapText('가나 다라마 바사', 5, width), ['가나', '다라마', '바사']);
eq('한 줄보다 긴 어절은 글자로 자른다', wrapText('가나다라마바사', 3, width), ['가나다', '라마바', '사']);
eq('줄바꿈과 빈 줄은 살린다', wrapText('가\n\n나', 5, width), ['가', '', '나']);
eq('끝의 빈 줄은 버린다', wrapText('가\n\n', 5, width), ['가']);
eq('연달은 공백은 하나로', wrapText('가    나', 5, width), ['가 나']);
eq('넘치면 말줄임표', fitText('가나다라마', 3, width), '가나…');
eq('안 넘치면 그대로', fitText('가나', 3, width), '가나');

section('답변 PDF');
const fonts = {
  regular: readFileSync('assets/fonts/Pretendard-Regular.ttf'),
  bold: readFileSync('assets/fonts/Pretendard-Bold.ttf'),
};
const grid = paper.map((q) => ({ no: q.no, answer: q.answer, chosen: q.no === 12 ? 1 : q.answer, mark: (q.no === 12 ? 'x' : 'o') as 'o' | 'x' }));
const doc: FeedbackDoc = {
  courseName: '목요일 19시 수학 실모반',
  examTitle: '3주차 · 강대K 5회',
  examDate: '2026-09-17',
  studentName: '김가영',
  tutorName: '이서현',
  issuedOn: '2026-09-23',
  score: {
    earned: 96,
    total: 100,
    sections: [{ label: '공통', earned: 70, total: 74 }, { label: '미적분', earned: 26, total: 26 }],
    wrongNos: [12],
    grid,
  },
  concerns: [
    { no: 12, mark: 'x', unitLabel: '수열', body: '규칙이 안 보여요 😭 ∑ aₙ', answer: '홀짝이 바뀌는 곳만 보세요.', image: null },
    { no: 21, mark: 'o', unitLabel: null, body: '맞았지만 시간이 오래 걸렸어요', answer: '긴 답. '.repeat(900), image: null },
    { no: 0, mark: null, unitLabel: null, body: '시간 배분', answer: null, image: { bytes: new Uint8Array([1, 2, 3]), type: 'jpg' } },
  ],
  overallComment: '방향을 정하는 연습을 해요.',
};
const pdfBytes = await renderFeedbackPdf(doc, fonts);
const loaded = await PDFDocument.load(pdfBytes);
ok('PDF 로 열린다', loaded.getPageCount() > 0);
ok('긴 답은 쪽을 넘겨 흐른다', loaded.getPageCount() >= 3, loaded.getPageCount());
ok('쓴 글자만 넣어 가볍다 (200KB 안)', pdfBytes.length < 200_000, pdfBytes.length);
eq('제목이 들어간다', loaded.getTitle(), '3주차 · 강대K 5회 질문 답변 — 김가영');
ok('깨진 풀이 사진이 있어도 멈추지 않는다', pdfBytes.length > 0);
const unscored = await renderFeedbackPdf({ ...doc, score: null, overallComment: null, concerns: doc.concerns.slice(0, 1) }, fonts);
ok('점수 없이도 만들어진다 (채점 전)', (await PDFDocument.load(unscored)).getPageCount() === 1);

/* ────────────────────────────────────────────────── 나눠 읽기 */

/**
 * Supabase 처럼 한 번에 cap 줄까지만 주는 가짜 표. in() 조건은 key 열로 거르고,
 * range 가 요청한 것보다 적게 돌려줄 수 있다 — 실제 서버 상한이 그렇게 동작한다.
 */
function fakeTable<T extends Record<string, string>>(all: T[], key: keyof T, cap: number) {
  return (batch: string[]) => ({
    range: async (from: number, to: number) => {
      const wanted = new Set(batch);
      const hit = all.filter((r) => wanted.has(r[key]));
      return { data: hit.slice(from, Math.min(to + 1, from + cap)), error: null };
    },
  });
}
const gridOf = (outer: number, inner: number, prefix: string) =>
  [...Array(outer)].flatMap((_, a) =>
    [...Array(inner)].map((__, q) => ({ owner: `${prefix}${a}`, item: `${prefix}${a}-${q}` })));
const idsOf = (list: { owner: string }[]) => [...new Set(list.map((r) => r.owner))];
const distinct = (list: { item: string }[]) => new Set(list.map((r) => r.item)).size;

section('나눠 읽기 — 1,000줄에서 잘리면 안 된다');
const answers = gridOf(40, 30, 'a');
const answersRead = await inChunks(idsOf(answers), fakeTable(answers, 'owner', 1000));
eq('응시 40개 × 답안 30개 = 1,200줄 전부', answersRead.length, 1200);
eq('겹친 줄이 없다', distinct(answersRead), 1200);
eq('서버 상한이 500이어도 전부',
  (await inChunks(idsOf(answers), fakeTable(answers, 'owner', 500))).length, 1200);
const many = gridOf(250, 30, 'm');
eq('id 250개(묶음 셋) × 30 = 7,500줄 전부',
  distinct(await inChunks(idsOf(many), fakeTable(many, 'owner', 1000))), 7500);
let pageThrew = false;
try {
  await inChunks(['x'], () => ({ range: async () => ({ data: null, error: new Error('boom') }) }));
} catch {
  pageThrew = true;
}
ok('못 읽으면 빈 목록이 아니라 던진다', pageThrew);

done();
