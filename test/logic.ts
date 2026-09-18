/**
 * DB 없이 도는 시험. `npm test` 가 이걸 돌린다.
 *
 * 여기 있는 것은 전부 순수 계산이라 늘 돌릴 수 있고 몇 초면 끝난다.
 * 점수를 어떻게 세는가 · 답을 어떻게 읽는가 · 사진에서 온 것을 어떻게 거르는가 ·
 * 답변 PDF 가 제대로 만들어지는가 — 틀리면 사람이 손해를 보는데, 화면만 봐서는
 * 틀린 줄 모르는 것들이다.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import {
  CONCERN,
  FULL_SCORE,
  LMS,
  PAPER,
  PHOTO_READ,
  QUESTION_COUNT,
  concernTopic,
  paperQuestion,
  paperSummary,
  sectionFull,
  unitLabel,
} from '../src/config/lms.ts';
import { addDays, fmtDay, fmtRate, fmtScore } from '../src/lib/format.ts';
import { loginIdProblem, passwordProblem } from '../src/lib/lms/credentials.ts';
import { concernOrder, fmtAnswer, isValidAnswer, parseAnswer, unitFits, unitsFor } from '../src/lib/lms/paper.ts';
import { hashPassword, verifyPassword } from '../src/lib/lms/password.ts';
import { READ_NOTES, mergeStudentReads, normalizeExtracted, readSummary, type ReadBatch } from '../src/lib/lms/ocr-rows.ts';
import {
  WATCH,
  needsRead,
  readDiffers,
  readProgressOf,
  readViewOf,
  watchDelay,
  watchStep,
  type PhotoReadRow,
} from '../src/lib/lms/photo-read-state.ts';
import { callTimeoutMs, canWaitFor, retryWaitMs, shouldRetry } from '../src/lib/lms/retry.ts';
import { parseAnswerLine } from '../src/lib/lms/answer-line.ts';
import { courseStats, scoreAttempt, trendsOf, type AnswerRow, type QuestionRow } from '../src/lib/lms/score.ts';
import { cleanConcerns, progressOf } from '../src/lib/lms/concerns.ts';
import { changedNos, gradingSnapshot, parseSnapshot } from '../src/lib/lms/grading-snapshot.ts';
import { draftPhotoPath, isIdShape, parseDraftPhotoPath } from '../src/lib/intake/paths.ts';
import { issueSession, readSession } from '../src/lib/lms/auth.ts';
import { readStudentAnswers } from '../src/lib/lms/ocr.ts';
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

section('로그인 쿠키 — 비밀번호가 바뀌면 옛 쿠키가 풀린다');
process.env.LMS_SESSION_SECRET ||= 'test-session-secret-0123456789';
const uid = '11111111-2222-4333-8444-555555555555';
const cookie = issueSession(uid, 'key-1').value;
eq('발급한 쿠키에서 사람과 열쇠를 꺼낸다', readSession(cookie), { userId: uid, key: 'key-1' });
eq('열쇠를 바꿔 끼우면 서명이 안 맞는다', readSession(cookie.replace('.key-1.', '.key-2.')), null);
eq('열쇠를 한 번도 안 뽑은 계정은 빈 열쇠', readSession(issueSession(uid, null).value)?.key, '-');
const v1Exp = Math.floor(Date.now() / 1000) + 60;
const v1Sig = createHmac('sha256', process.env.LMS_SESSION_SECRET).update(`v1.${uid}.${v1Exp}`).digest('hex');
eq('열쇠가 생기기 전의 쿠키(v1)는 빈 열쇠로 읽는다', readSession(`v1.${uid}.${v1Exp}.${v1Sig}`), { userId: uid, key: '-' });
const oldExp = Math.floor(Date.now() / 1000) - 1;
const expired = `v2.${uid}.key-1.${oldExp}`;
eq('만료된 쿠키는 버린다',
  readSession(`${expired}.${createHmac('sha256', process.env.LMS_SESSION_SECRET).update(expired).digest('hex')}`), null);

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
const { pdf: pdfBytes, missingImages } = await renderFeedbackPdf(doc, fonts);
const loaded = await PDFDocument.load(pdfBytes);
ok('PDF 로 열린다', loaded.getPageCount() > 0);
ok('긴 답은 쪽을 넘겨 흐른다', loaded.getPageCount() >= 3, loaded.getPageCount());
ok('쓴 글자만 넣어 가볍다 (200KB 안)', pdfBytes.length < 200_000, pdfBytes.length);
eq('제목이 들어간다', loaded.getTitle(), '3주차 · 강대K 5회 질문 답변 — 김가영');
ok('깨진 풀이 사진이 있어도 멈추지 않는다', pdfBytes.length > 0);
eq('싣지 못한 풀이 사진은 어느 질문인지 알린다 — 보내기가 여기서 멈춘다', missingImages, [0]);
const unfetched = await renderFeedbackPdf(
  { ...doc, concerns: [{ ...doc.concerns[0], image: { bytes: new Uint8Array(0), type: 'png' } }] },
  fonts,
);
eq('못 받아 온 사진(빈 바이트)도 싣지 못한 것으로 친다', unfetched.missingImages, [12]);
// 1×1 PNG. 멀쩡한 사진까지 빠졌다고 하면 답변 PDF 가 하나도 안 나간다.
const dot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const photo = await renderFeedbackPdf(
  { ...doc, concerns: [{ ...doc.concerns[0], image: { bytes: new Uint8Array(dot), type: 'png' } }] },
  fonts,
);
eq('실은 풀이 사진은 빠진 것으로 치지 않는다', photo.missingImages, []);
const unscored = await renderFeedbackPdf({ ...doc, score: null, overallComment: null, concerns: doc.concerns.slice(0, 1) }, fonts);
ok('점수 없이도 만들어진다 (채점 전)', (await PDFDocument.load(unscored.pdf)).getPageCount() === 1);
eq('사진이 없는 질문만 있으면 빠진 사진도 없다', unscored.missingImages, []);

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

/* ─────────────────────────────────────────────── 사진으로 자동 채점 (0016) */

section('학생 시험지에서 읽은 답 합치기');
const batch = (offset: number, count: number, answers: ReadBatch['answers'], unreadable: number[] = []): ReadBatch =>
  ({ offset, count, answers, unreadable_photos: unreadable });
const ans = (no: number, answer: number | null, sure = true, note: string | null = null) => ({ no, answer, sure, note });
const byNoOf = <T extends { no: number }>(list: T[]) => new Map(list.map((a) => [a.no, a]));

const one = mergeStudentReads([batch(0, 4, [ans(1, 3), ans(16, 12), ans(21, null)])]);
eq('늘 1–30 번 한 벌', one.answers.map((a) => a.no), PAPER.map((q) => q.no));
const oneBy = byNoOf(one.answers);
eq('확실한 답은 그대로', [oneBy.get(1), oneBy.get(16)], [ans(1, 3), ans(16, 12)]);
eq('확실한 빈칸은 빈칸 · 확실', oneBy.get(21), ans(21, null));
eq('안 보인 번호는 찾지 못함', oneBy.get(2), ans(2, null, false, READ_NOTES.missing));
eq('0번 · 31번 · 2.5번은 버린다',
  mergeStudentReads([batch(0, 1, [ans(0, 1), ans(31, 1), ans(2.5, 1)])]).answers.filter((a) => a.sure).length, 0);
eq('5지선다에 7이면 못 읽은 것', byNoOf(mergeStudentReads([batch(0, 1, [ans(3, 7)])]).answers).get(3),
  ans(3, null, false, READ_NOTES.invalid(7)));
eq('단답형 1000 도 못 읽은 것', byNoOf(mergeStudentReads([batch(0, 1, [ans(17, 1000)])]).answers).get(17)?.answer, null);

const clashRead = byNoOf(mergeStudentReads([
  batch(0, 4, [ans(5, 3)]),
  batch(4, 4, [ans(5, 4)]),
  batch(8, 4, [ans(5, 3)]),
]).answers);
eq('사진마다 답이 다르면 비우고 확인', clashRead.get(5), ans(5, null, false, READ_NOTES.conflict(3, 4)));

const blankThenValue = byNoOf(mergeStudentReads([batch(0, 1, [ans(21, null)]), batch(1, 1, [ans(21, 17)])]).answers);
eq('문제지는 빈칸 · 답안지에 답이면 답', blankThenValue.get(21), ans(21, 17));
const blankThenBlur = byNoOf(mergeStudentReads([batch(0, 1, [ans(22, null)]), batch(1, 1, [ans(22, null, false, '흐림')])]).answers);
eq('확실한 빈칸 + 못 읽음 = 확인', blankThenBlur.get(22), ans(22, null, false, '흐림'));
const sureAndNot = byNoOf(mergeStudentReads([batch(0, 1, [ans(8, 5, false, '?')]), batch(1, 1, [ans(8, 5)])]).answers);
eq('같은 답이면 한쪽만 확실해도 확실', sureAndNot.get(8), ans(8, 5));
const bothUnsure = byNoOf(mergeStudentReads([batch(0, 1, [ans(8, 5, false, '②?')]), batch(1, 1, [ans(8, 5, false, '④?')])]).answers);
eq('둘 다 애매하면 확인 (앞의 이유)', bothUnsure.get(8), ans(8, 5, false, '②?'));

const oddFirst = byNoOf(mergeStudentReads([batch(0, 1, [ans(12, 9)]), batch(1, 1, [ans(12, 2)])]).answers).get(12);
const oddLast = byNoOf(mergeStudentReads([batch(0, 1, [ans(12, 2)]), batch(1, 1, [ans(12, 9)])]).answers).get(12);
eq('올 수 없는 답이 섞이면 답은 쓰되 확인', oddFirst, ans(12, 2, false, READ_NOTES.mixed(9)));
eq('읽힌 순서가 달라도 같다', oddLast, oddFirst);

eq('흐린 사진 번호는 전체 순번으로', mergeStudentReads([
  batch(0, 4, [], [2]),
  batch(4, 4, [], [1, 4, 5, 0]),
]).unreadable, [1, 4, 7]);
const longNote = byNoOf(mergeStudentReads([batch(0, 1, [ans(9, null, false, `  ${'가'.repeat(200)}\n줄  `)])]).answers).get(9)!;
ok('이유는 한 줄 · 80자 안', Array.from(longNote.note!).length <= 80 && !longNote.note!.includes('\n'), longNote.note);
eq('확실한 줄에는 이유를 안 붙인다', byNoOf(mergeStudentReads([batch(0, 1, [ans(4, 4, true, '잘 보임')])]).answers).get(4)?.note, null);

const summary = readSummary(mergeStudentReads([batch(0, 4, [ans(1, 3), ans(2, null), ans(3, 1, false, '?')])]).answers);
eq('요약 — 확실 2 · 빈칸 1', [summary.sure, summary.blanks], [2, [2]]);
ok('요약 — 확인할 번호에 3번과 안 보인 번호', summary.check.includes(3) && summary.check.includes(30) && !summary.check.includes(1));

section('사진 읽기 상태');
const NOW = Date.parse('2026-09-18T03:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const readRow = (over: Partial<PhotoReadRow>): PhotoReadRow => ({
  attempt_id: 'a', request_no: 1, status: 'done', requested_at: at(60_000), started_at: at(50_000),
  finished_at: at(10_000), photo_ids: ['p1', 'p2'], answers: one.answers, unreadable: [], note: null,
  error: null, runs: 1, updated_at: at(10_000), ...over,
});
eq('읽기가 없으면 none', readViewOf(null, ['p1'], NOW).kind, 'none');
eq('부른 적 없는 줄도 none', readViewOf(readRow({ request_no: 0 }), ['p1'], NOW).kind, 'none');
eq('사진이 없으면 읽을 것도 없다 (실패여도)', readViewOf(readRow({ status: 'failed', error: 'TIMEOUT' }), [], NOW).kind, 'none');
eq('기다리는 중은 reading', readViewOf(readRow({ status: 'pending', updated_at: at(60_000) }), ['p1'], NOW).kind, 'reading');
eq('딱 10분까지는 reading', readViewOf(readRow({ status: 'running', updated_at: at(PHOTO_READ.stuckMs) }), ['p1'], NOW).kind, 'reading');
eq('10분이 넘으면 stuck', readViewOf(readRow({ status: 'running', updated_at: at(PHOTO_READ.stuckMs + 1) }), ['p1'], NOW).kind, 'stuck');
const failedView = readViewOf(readRow({ status: 'failed', error: null }), ['p1'], NOW);
eq('실패 이유가 비었으면 UNKNOWN', failedView.kind === 'failed' ? failedView.error : null, 'UNKNOWN');
const doneView = readViewOf(readRow({ unreadable: ['p2', 'gone'] }), ['p2', 'p1'], NOW);
ok('순서만 바뀐 사진은 낡지 않았다', doneView.kind === 'done' && !doneView.stale);
eq('흐린 사진은 지금 있는 것만', doneView.kind === 'done' ? doneView.unreadable : null, ['p2']);
ok('사진이 바뀌면 낡았다', (() => { const v = readViewOf(readRow({}), ['p1', 'p3'], NOW); return v.kind === 'done' && v.stale; })());

// 반별 목록은 사진 id 를 안 쥐고 장수만 센다. 첫 읽기가 끝나기 전에는 결과의 photo_ids 가
// 비어 있어, 그걸 '지금 사진' 으로 넘기면 읽는 중 · 실패 · 멈춤이 전부 '시작 전' 이 된다.
const firstRun = (over: Partial<PhotoReadRow>) => readRow({ photo_ids: [], finished_at: null, ...over });
eq('첫 읽기 — 기다리는 중', readProgressOf(firstRun({ status: 'pending', updated_at: at(60_000) }), 3, NOW), 'reading');
eq('첫 읽기 — 읽는 중', readProgressOf(firstRun({ status: 'running', updated_at: at(60_000) }), 3, NOW), 'reading');
eq('첫 읽기 — 실패', readProgressOf(firstRun({ status: 'failed', error: 'TIMEOUT' }), 3, NOW), 'failed');
eq('첫 읽기 — 멈춤', readProgressOf(firstRun({ status: 'running', updated_at: at(PHOTO_READ.stuckMs + 1) }), 3, NOW), 'stuck');
eq('읽은 결과를 지금 사진으로 넘기면 놓친다 (하면 안 되는 것)',
  readViewOf(firstRun({ status: 'failed', error: 'TIMEOUT' }), [], NOW).kind, 'none');
eq('사진이 0장이면 그대로 시작 전', readProgressOf(firstRun({ status: 'running' }), 0, NOW), 'none');
eq('부른 적 없으면 시작 전', readProgressOf(readRow({ request_no: 0 }), 3, NOW), 'none');
eq('끝난 읽기는 done — 사진이 바뀌었는지는 여기서 안 본다', readProgressOf(readRow({}), 5, NOW), 'done');
eq('두 함수가 같은 답을 한다', readViewOf(readRow({ status: 'pending' }), ['p1', 'p2'], NOW).kind,
  readProgressOf(readRow({ status: 'pending' }), 2, NOW));

section('다시 읽어야 하나');
eq('사진이 없으면 아니다', needsRead({ kind: 'none' }, 0), false);
eq('읽는 중이면 아니다', needsRead({ kind: 'reading', since: at(0) }, 3), false);
eq('다 읽었고 그대로면 아니다', needsRead(doneView, 2), false);
eq('사진이 바뀌었으면 그렇다', needsRead({ ...(doneView as Extract<typeof doneView, { kind: 'done' }>), stale: true }, 2), true);
eq('실패 · 멈춤 · 처음이면 그렇다',
  [needsRead({ kind: 'failed', error: 'X', at: null }, 1), needsRead({ kind: 'stuck', since: at(0) }, 1), needsRead({ kind: 'none' }, 1)],
  [true, true, true]);

section('튜터 채점과 읽은 답 견주기');
const readForDiff = [ans(1, 3), ans(2, 5), ans(3, null), ans(4, 2, false), ans(5, 4)];
eq('같으면 없음', readDiffers([ans(1, 3)], [{ no: 1, chosen: 3, correct: true }]), []);
eq('학생 답이 다르면 짚는다', readDiffers(readForDiff, [
  { no: 1, chosen: 3, correct: true },
  { no: 2, chosen: 1, correct: false },
  { no: 3, chosen: null, correct: false },
  { no: 4, chosen: 1, correct: false },
  { no: 5, chosen: null, correct: true },
]), [2]);
eq('빈칸으로 읽혔는데 O 면 짚는다', readDiffers([ans(3, null)], [{ no: 3, chosen: null, correct: true }]), [3]);
eq('튜터가 안 매긴 문항은 짚는다', readDiffers([ans(6, 1)], []), [6]);

section('채점 화면이 본 판 — 오래 열어 둔 화면 알아보기');
const qa = '00000000-0000-4000-8000-00000000000a';
const qb = '00000000-0000-4000-8000-00000000000b';
const snapQuestions: QuestionRow[] = [
  { id: qa, no: 1, points: 2, answer: 3, unit_code: null },
  { id: qb, no: 2, points: 2, answer: 5, unit_code: null },
];
const snap = gradingSnapshot(snapQuestions, [{ question_id: qa, correct: true, chosen: 3 }]);
eq('정오와 정답표를 함께 담는다', snap, {
  answers: [{ question_id: qa, correct: true, chosen: 3 }],
  key: [{ question_id: qa, answer: 3 }, { question_id: qb, answer: 5 }],
});
eq('폼에서 온 판을 그대로 읽는다', parseSnapshot(JSON.stringify(snap)), snap);
eq('빈 칸이면 판 없음', parseSnapshot(''), null);
eq('JSON 이 아니면 판 없음', parseSnapshot('{'), null);
eq('문항 id 가 uuid 가 아니면 판 없음 (DB 가 알아볼 수 없는 오류를 내지 않게)',
  parseSnapshot(JSON.stringify({ answers: [{ question_id: 'x', correct: true, chosen: null }], key: [] })), null);
eq('정답표가 빠지면 판 없음', parseSnapshot(JSON.stringify({ answers: [] })), null);
eq('같으면 바뀐 문항 없음', changedNos(snap, snap, snapQuestions), []);
eq('사진 채점이 비워지면 그 문항을 짚는다',
  changedNos(snap, gradingSnapshot(snapQuestions, []), snapQuestions), [1]);
eq('새로 매겨진 문항도 짚는다',
  changedNos(snap, gradingSnapshot(snapQuestions, [
    { question_id: qa, correct: true, chosen: 3 },
    { question_id: qb, correct: false, chosen: 1 },
  ]), snapQuestions), [2]);
eq('정답이 바뀐 문항을 짚는다',
  changedNos(snap, gradingSnapshot([snapQuestions[0], { ...snapQuestions[1], answer: 4 }],
    [{ question_id: qa, correct: true, chosen: 3 }]), snapQuestions), [2]);

section('접수 사진 경로 — 올리는 쪽과 제출받는 쪽이 같은 모양을 본다');
const draft = '0b7c6f1e-1111-4222-8333-444455556666';
const photoPath = draftPhotoPath(draft, 'korean', 'a1b2c3d4-e5f6');
eq('만든 경로를 그대로 푼다', parseDraftPhotoPath(photoPath), { draftId: draft, subject: 'korean' });
eq('다른 폴더면 못 푼다', parseDraftPhotoPath(`raw/other/${draft}/korean/a1b2c3d4-e5f6.jpg`), null);
eq('확장자가 다르면 못 푼다', parseDraftPhotoPath(photoPath.replace('.jpg', '.png')), null);
eq('경로를 거슬러 올라가지 못한다', parseDraftPhotoPath(`raw/drafts/${draft}/korean/../x/a1b2c3d4-e5f6.jpg`), null);
ok('uuid 는 id 모양이다', isIdShape(draft));
ok('짧거나 이상한 글자는 아니다', !isIdShape('abc') && !isIdShape('a/b/c/d/e/f') && !isIdShape(undefined));

section('재시도 시간 — 전체 마감을 넘지 않는다');
const headersOf = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? null });
eq('429 · 500 · 529 · 끊김은 다시', [
  shouldRetry({ status: 429 }), shouldRetry({ status: 500 }), shouldRetry({ status: 529 }), shouldRetry({ connection: true }),
], [true, true, true, true]);
eq('400 · 401 · 413 은 다시 안 함', [shouldRetry({ status: 400 }), shouldRetry({ status: 401 }), shouldRetry({ status: 413 })], [false, false, false]);
eq('서버가 하지 말라면 안 함', shouldRetry({ status: 503, headers: headersOf({ 'x-should-retry': 'false' }) }), false);
eq('서버가 하라면 함', shouldRetry({ status: 400, headers: headersOf({ 'x-should-retry': 'true' }) }), true);
eq('retry-after-ms 를 따른다', retryWaitMs({ headers: headersOf({ 'retry-after-ms': '250' }) }, 0), 250);
eq('retry-after 초를 따른다', retryWaitMs({ headers: headersOf({ 'retry-after': '30' }) }, 0), 30_000);
eq('retry-after 날짜를 따른다',
  retryWaitMs({ headers: headersOf({ 'retry-after': new Date(NOW + 3_000).toUTCString() }) }, 0, NOW), 3_000);
eq('말이 없으면 0.5초부터 두 배, 8초까지', [0, 1, 2, 3, 4, 5].map((n) => retryWaitMs({ status: 503 }, n)),
  [500, 1_000, 2_000, 4_000, 8_000, 8_000]);
const budget = { reserveMs: 1_000, minCallMs: 2_000, maxCallMs: 5_000 };
eq('요청 시간은 상한까지', callTimeoutMs(10_000, 0, budget), 5_000);
eq('남은 만큼만 준다', callTimeoutMs(10_000, 7_000, budget), 2_000);
eq('모자라면 보내지 않는다', callTimeoutMs(10_000, 7_500, budget), null);
eq('기다려도 한 번 더 보낼 수 있으면 기다린다', canWaitFor(10_000, 0, 3_000, budget), true);
eq('기다리면 마감을 넘으면 안 기다린다', canWaitFor(10_000, 0, 8_000, budget), false);

section('화면이 읽기를 기다리는 법 — 멈춤을 놓치지 않는다');
ok('서버가 멈춤이라 하는 때보다 오래 지켜본다', WATCH.giveUpMs > PHOTO_READ.stuckMs + PHOTO_READ.quietMs);
eq('8분 4초에 아직 읽는 중이면 계속 묻는다', watchStep('reading', 8 * 60_000 + 4_000), 'wait');
eq('못 물었으면 계속 묻는다', watchStep(undefined, 60_000), 'wait');
eq('끝 · 실패 · 멈춤 · 없음이면 새로 그린다',
  ['done', 'failed', 'stuck', 'none'].map((k) => watchStep(k, 1_000)), ['refresh', 'refresh', 'refresh', 'refresh']);
eq('오래 기다렸으면 새로 그린다', watchStep('reading', WATCH.giveUpMs), 'refresh');
eq('처음엔 자주, 나중엔 드물게', [watchDelay(0), watchDelay(WATCH.slowAfterMs)], [WATCH.everyMs, WATCH.slowEveryMs]);

// 가짜 시계: 사진을 올리고 30초 뒤 읽기가 시작됐는데 서버에서 끊겼다. 화면이 새로 그릴 때
// 서버는 반드시 '멈춤' 이라고 답해야 '다시 읽기' 가 나온다.
{
  const start = NOW;
  const died: PhotoReadRow = readRow({ status: 'running', updated_at: new Date(start + PHOTO_READ.quietMs).toISOString() });
  let t = 0;
  let decided: 'wait' | 'refresh' = 'wait';
  let kind = 'reading';
  let polls = 0;
  while (decided === 'wait' && polls < 10_000) {
    t += watchDelay(t);
    polls += 1;
    kind = readViewOf(died, ['p1', 'p2'], start + t).kind;
    decided = watchStep(kind, t);
  }
  ok('끊긴 읽기 — 화면이 새로 그리는 때 서버는 멈춤이라 답한다', decided === 'refresh' && readViewOf(died, ['p1', 'p2'], start + t).kind === 'stuck', { t, kind });
  ok('11분 안팎에서 새로 그린다', t <= WATCH.giveUpMs + WATCH.slowEveryMs, t);
  ok('묻는 횟수가 과하지 않다', polls < 80, polls);
}

section('사진 읽기 요청 — 마감 시각 안에서만 (가짜 모델 서버)');
{
  type Reply = { kind: 'hang' } | { kind: 'status'; status: number; headers?: Record<string, string> } | { kind: 'ok'; body: unknown };
  let script: Reply[] = [];
  let calls = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls += 1;
      const reply = script.length > 1 ? script.shift()! : script[0];
      if (reply.kind === 'hang') return;
      if (reply.kind === 'status') {
        res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
        res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(reply.body) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  // 클라이언트는 부를 때마다 새로 만들어져 이 값을 읽는다 (ocr.ts).
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

  const img = { media_type: 'image/jpeg', data: Buffer.from('fake').toString('base64') };
  const fast = { minCallMs: 100, reserveMs: 100, callTimeoutMs: 5_000, maxRetries: 2 };
  const good = { answers: [{ no: 1, answer: 3, sure: true, note: null }], unreadable_photos: [], note: '' };
  const run = async (replies: Reply[], budgetMs: number, images = [img]) => {
    script = replies;
    calls = 0;
    const started = Date.now();
    const result = await readStudentAnswers(images, { ...fast, deadline: started + budgetMs });
    return { result, calls, ms: Date.now() - started };
  };
  const reasonOf = (r: Awaited<ReturnType<typeof readStudentAnswers>>) => (r.ok ? 'OK' : r.reason);

  const longWait = await run([{ kind: 'status', status: 429, headers: { 'retry-after': '30' } }], 1_500);
  eq('30초 기다리라면 기다리지 않고 멈춘다', [reasonOf(longWait.result), longWait.calls], ['RATE_LIMIT', 1]);
  ok('곧바로 끝난다', longWait.ms < 1_000, longWait.ms);

  const hang = await run([{ kind: 'hang' }], 1_200);
  eq('응답이 없으면 시간 초과 · 한 번만', [reasonOf(hang.result), hang.calls], ['TIMEOUT', 1]);
  ok('마감 전에 끝난다', hang.ms <= 1_200, hang.ms);
  await new Promise((resolve) => setTimeout(resolve, 400));
  eq('끝난 뒤에 더 부르지 않는다', calls, 1);

  const flaky = await run([
    { kind: 'status', status: 503, headers: { 'retry-after-ms': '10' } },
    { kind: 'status', status: 529, headers: { 'retry-after-ms': '10' } },
    { kind: 'ok', body: good },
  ], 3_000);
  eq('두 번 실패해도 세 번째에 읽는다', [reasonOf(flaky.result), flaky.calls], ['OK', 3]);

  const down = await run([{ kind: 'status', status: 503, headers: { 'retry-after-ms': '10' } }], 3_000);
  eq('계속 실패하면 세 번에서 멈춘다', [reasonOf(down.result), down.calls], ['API_ERROR', 3]);

  const refuseRetry = await run([{ kind: 'status', status: 503, headers: { 'x-should-retry': 'false' } }], 3_000);
  eq('서버가 하지 말라면 한 번만', [reasonOf(refuseRetry.result), refuseRetry.calls], ['API_ERROR', 1]);

  const tooLate = await run([{ kind: 'ok', body: good }], 150);
  eq('남은 시간이 모자라면 보내지도 않는다', [reasonOf(tooLate.result), tooLate.calls], ['TIMEOUT', 0]);

  const twoChunks = await run([{ kind: 'status', status: 400 }], 3_000, [img, img, img, img, img]);
  ok('한 요청이 실패하면 전체가 실패 · 나머지는 새로 안 보낸다',
    reasonOf(twoChunks.result) === 'API_ERROR' && twoChunks.calls <= 2, { reason: reasonOf(twoChunks.result), calls: twoChunks.calls });

  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedUrl;
}

done();
