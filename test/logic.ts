/**
 * DB 없이 도는 시험. `npm test` 가 이걸 돌린다.
 *
 * 여기 있는 것은 전부 순수 계산이라 늘 돌릴 수 있고 1초도 안 걸린다.
 * 점수를 어떻게 세는가 · 비밀번호를 어떻게 다루는가 · 사진에서 온 것을 어떻게 거르는가 —
 * 셋 다 틀리면 사람이 손해를 보는데, 화면만 봐서는 틀린 줄 모르는 것들이다.
 */
import {
  AREAS,
  LMS,
  areaLabel,
  layoutAreaFor,
  layoutSummary,
  loginIdProblem,
  passwordProblem,
  fmtScore,
  fmtRate,
} from '../src/config/lms.ts';
import { hashPassword, verifyPassword } from '../src/lib/lms/password.ts';
import { normalizeExtracted } from '../src/lib/lms/ocr-rows.ts';
import {
  areaTrends,
  courseStats,
  questionsFor,
  scoreAttempt,
  type QuestionRow,
} from '../src/lib/lms/score.ts';
import { defaultQuestionRows } from '../src/lib/lms/exams.ts';
import { done, eq, ok, section } from './assert.ts';

/* ────────────────────────────────────────────────── 문항표 배치 */

section('영역과 기본 배치');
ok('갈래복합이 목록에 있다', AREAS.some((a) => a.code === 'lit_complex'));
ok('현대시는 갈래복합으로 대체됐다', !AREAS.some((a) => a.code === 'lit_modern_poem'));
ok('독서 네 영역이 모두 배치에 있다',
  ['read_theory', 'read_humanities', 'read_social', 'read_science']
    .every((c) => [...Array(34)].some((_, i) => layoutAreaFor(i + 1) === c)));
ok('문학 네 영역도 모두',
  ['lit_complex', 'lit_modern_novel', 'lit_classic_novel', 'lit_classic_poem']
    .every((c) => [...Array(34)].some((_, i) => layoutAreaFor(i + 1) === c)));
ok('35번부터는 선택과목 구간', layoutAreaFor(35) === null);
ok('안내 문구를 표에서 만든다', layoutSummary().includes('갈래복합') && layoutSummary().endsWith('35– 선택과목'));

const seeded = defaultQuestionRows(45);
eq('45문항 + 선택 한 벌 더 = 56줄', seeded.length, 56);
eq('35번이 화작·언매 두 줄', seeded.filter((r) => r.no === 35).length, 2);
eq('34번은 한 줄', seeded.filter((r) => r.no === 34).length, 1);
ok('선택과목을 하나만 고르면 한 벌', defaultQuestionRows(45, ['speech']).length === 45);

/* ────────────────────────────────────────────────── 채점 */

const q = (no: number, area: string, points = 2): QuestionRow =>
  ({ id: `q${no}-${area}`, no, area_code: area, points, answer: null, passage: null });
const paper: QuestionRow[] = seeded.map((r, i) => ({ ...r, id: `q${i}`, answer: null }));

section('선택과목 — 남의 문항은 틀린 게 아니라 없는 것');
eq('화작 학생이 푸는 문항 수', questionsFor(paper, 'speech').length, 45);
eq('언매 학생도 같다', questionsFor(paper, 'media').length, 45);
eq('선택과목 미정이면 공통만', questionsFor(paper, null).length, 34);
ok('화작 학생에게 언매 문항은 안 보인다',
  questionsFor(paper, 'speech').every((x) => x.area_code !== 'el_media'));

const allRight = (qs: QuestionRow[]) => qs.map((x) => ({ question_id: x.id, correct: true, chosen: null }));
const speechFull = scoreAttempt(paper, allRight(questionsFor(paper, 'speech')), 'speech');
const mediaFull = scoreAttempt(paper, allRight(questionsFor(paper, 'media')), 'media');
eq('화작 만점 90점', speechFull.earned, 90);
eq('언매 만점도 90점 (68점 아님)', mediaFull.total, 90);

section('안 매긴 문항은 오답이 아니다');
const half = scoreAttempt(paper, allRight(questionsFor(paper, 'speech')).slice(0, 10), 'speech');
eq('매긴 것만 득점', half.earned, 20);
eq('만점은 그대로', half.total, 90);
ok('채점이 안 끝난 것으로 잡힌다', !half.complete);
eq('정답률은 매긴 것 기준', half.rate, 1);
ok('아무것도 안 매기면 미완료', !scoreAttempt(paper, [], 'speech').complete);

section('틀린 문항 찾기');
const mine = questionsFor(paper, 'speech');
const wrongIds = new Set(mine.filter((x) => x.area_code === 'lit_complex').slice(0, 4).map((x) => x.id));
const mixed = scoreAttempt(paper, mine.map((x) => ({ question_id: x.id, correct: !wrongIds.has(x.id), chosen: null })), 'speech');
eq('4문항 틀려 82점', mixed.earned, 82);
eq('틀린 문항 번호가 오름차순', mixed.wrongNos, [18, 19, 20, 21]);
eq('갈래복합 2/6', mixed.areas.find((a) => a.code === 'lit_complex')?.correct, 2);
eq('영역 순서는 시험지 순서', mixed.areas.map((a) => a.code).slice(0, 4),
  ['read_theory', 'read_humanities', 'read_social', 'read_science']);
eq('묶음은 독서·문학·선택', mixed.groups.map((g) => g.group), ['reading', 'literature', 'elective']);

section('배점이 다른 문항');
const weighted = [q(1, 'read_theory', 2), q(2, 'read_theory', 3)];
eq('3점 문항만 맞히면 3점',
  scoreAttempt(weighted, [{ question_id: 'q2-read_theory', correct: true, chosen: null }], null).earned, 3);

/* ────────────────────────────────────────────────── 반 비교 */

section('석차와 반 평균');
const at = (n: number) => scoreAttempt(paper, mine.map((x, i) => ({ question_id: x.id, correct: i < n, chosen: null })), 'speech');
const stats = courseStats([
  { studentId: 'a', name: '가', score: at(45) },
  { studentId: 'b', name: '나', score: at(40) },
  { studentId: 'c', name: '다', score: at(40) },
  { studentId: 'd', name: '라', score: scoreAttempt(paper, [], 'speech') },
]);
eq('채점 끝난 사람만 센다', stats.counted, 3);
eq('동점은 같은 등수, 다음은 건너뛴다', stats.standings.map((s) => s.rank), [1, 2, 2, 0]);
eq('평균은 채점 끝난 3명만 — (90+80+80)/3', Math.round(stats.average * 10) / 10, 83.3);
eq('미채점자는 평균 대비 0', stats.standings.find((s) => s.studentId === 'd')?.vsAverage, 0);
ok('최고·최저', stats.highest === 90 && stats.lowest === 80);

section('누적 영역 추이');
const trends = areaTrends([{ score: mixed }, { score: speechFull }]);
ok('약한 순으로 정렬', trends[0].rate <= trends[trends.length - 1].rate);
eq('회차가 합산된다', trends.find((t) => t.code === 'lit_complex')?.graded, 12);
eq('가장 약한 영역은 갈래복합', trends[0].code, 'lit_complex');

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

/* ────────────────────────────────────────────────── 사진에서 읽은 것 */

section('사진에서 온 것 거르기 — 지어낸 값이 저장되면 안 된다');
const raw = (no: number, area: string | null = null, points: number | null = 2, answer: number | null = null) =>
  ({ no, area_code: area, points, answer, passage: null });

eq('영역을 못 읽으면 통상 배치로 메운다',
  normalizeExtracted([raw(1), raw(20), raw(30)]).map((r) => r.area_code),
  ['read_theory', 'lit_complex', 'lit_classic_novel']);
ok('메운 줄에 표시가 남는다', normalizeExtracted([raw(1)])[0].areaGuessed);
ok('읽은 줄은 표시가 없다', !normalizeExtracted([raw(1, 'read_social')])[0].areaGuessed);
ok('목록에 없는 영역 코드는 못 읽은 것으로', normalizeExtracted([raw(5, 'lit_modern_poem')])[0].areaGuessed);
eq('0번·음수·범위 밖 번호는 버린다', normalizeExtracted([raw(0), raw(-3), raw(9999)]).length, 0);
eq('소수 번호도 버린다', normalizeExtracted([{ ...raw(1), no: 1.5 }]).length, 0);
eq('정답이 6이면 비운다', normalizeExtracted([raw(1, null, 2, 6)])[0].answer, null);
eq('정답 3은 남긴다', normalizeExtracted([raw(1, null, 2, 3)])[0].answer, 3);
eq('배점이 없으면 2점', normalizeExtracted([raw(1, null, null)])[0].points, 2);
eq('배점이 음수면 2점', normalizeExtracted([raw(1, null, -5)])[0].points, 2);
eq('35번 화작·언매는 둘 다 남는다',
  normalizeExtracted([raw(35, 'el_media'), raw(35, 'el_speech')]).length, 2);
eq('같은 번호·같은 영역이 두 번 오면 하나만',
  normalizeExtracted([raw(35, 'el_speech'), raw(35, 'el_speech')]).length, 1);
eq('번호 오름차순으로 정렬',
  normalizeExtracted([raw(35, 'el_speech'), raw(1, 'read_theory')]).map((r) => r.no), [1, 35]);

/* ────────────────────────────────────────────────── 화면에 찍히는 값 */

section('숫자 표기');
eq('정수는 소수점 없이', fmtScore(78), '78');
eq('소수는 첫째 자리까지', fmtScore(78.25), '78.3');
eq('비율은 반올림 퍼센트', fmtRate(0.8235), '82%');
eq('영역 이름', areaLabel('lit_complex'), '갈래복합');
eq('모르는 코드는 코드를 그대로', areaLabel('nope'), 'nope');

done();
