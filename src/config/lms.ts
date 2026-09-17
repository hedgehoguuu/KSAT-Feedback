// LMS 설정 단일 출처. 역할 · 시험지 모양 · 단원 · 상태값이 전부 여기서 나온다.
//
// 기존 서비스(/apply, /class)가 '한 번 보내고 끝나는' 접수라면 LMS(/lms)는 '쌓이는' 쪽이다.
// 수업은 수학 실전 모의고사이고, 학생은 전부 미적분을 고른다 (2026-09-17 전환).
// 시험지 모양이 하나로 고정돼 있어서, 번호만 알면 배점 · 5지선다/단답형 · 공통/미적분이 정해진다.

/* ────────────────────────────────────────────────────────────── 역할 */

export const ROLES = {
  admin: '관리자',
  tutor: '튜터',
  student: '학생',
} as const;
export type Role = keyof typeof ROLES;
export const ROLE_LIST = Object.keys(ROLES) as Role[];

export function isRole(v: string): v is Role {
  return v in ROLES;
}

/** 로그인 직후 어디로 보낼지. 역할마다 첫 화면이 다르다. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/lms/admin',
  tutor: '/lms/tutor',
  student: '/lms/me',
};

/* ─────────────────────────────────────────────────────────── 과목 */

/** 화면 · PDF · 메일에 붙는 과목 이름. */
export const SUBJECT = {
  name: '수학',
  elective: '미적분',
  /** "수학 실전 모의고사" — PDF 머리말과 메일 발신자에 쓴다. */
  course: '수학 실전 모의고사',
} as const;

/* ─────────────────────────────────────────────────────── 시험지 모양 */

export const SECTIONS = { common: '공통', calculus: '미적분' } as const;
export type Section = keyof typeof SECTIONS;
export const SECTION_LIST = Object.keys(SECTIONS) as Section[];

export const KINDS = { choice: '5지선다', short: '단답형' } as const;
export type Kind = keyof typeof KINDS;

export type PaperQuestion = {
  no: number;
  section: Section;
  kind: Kind;
  points: number;
};

/**
 * 수능 수학 영역(공통 + 선택)의 번호별 배점. 실전 모의고사도 이 틀을 그대로 따른다.
 *
 *   공통   1–2 2점 · 3–8 3점 · 9–15 4점 (5지선다) · 16–19 3점 · 20–22 4점 (단답형)  = 74점
 *   미적분 23 2점 · 24–27 3점 · 28 4점 (5지선다) · 29–30 4점 (단답형)            = 26점
 *
 * `to` 는 그 구간이 끝나는 번호다. 시험 틀이 바뀌면 이 표 한 곳만 고친다 — 문항표 화면 ·
 * 채점 · 집계 · PDF 가 전부 여기서 번호의 성격을 읽는다. 다만 이미 만든 회차는 만들 때의
 * 배점을 문항표에 적어 두므로(lms_exam_questions.points) 지난 점수는 달라지지 않는다.
 */
const BANDS: readonly { to: number; section: Section; kind: Kind; points: number }[] = [
  { to: 2, section: 'common', kind: 'choice', points: 2 },
  { to: 8, section: 'common', kind: 'choice', points: 3 },
  { to: 15, section: 'common', kind: 'choice', points: 4 },
  { to: 19, section: 'common', kind: 'short', points: 3 },
  { to: 22, section: 'common', kind: 'short', points: 4 },
  { to: 23, section: 'calculus', kind: 'choice', points: 2 },
  { to: 27, section: 'calculus', kind: 'choice', points: 3 },
  { to: 28, section: 'calculus', kind: 'choice', points: 4 },
  { to: 30, section: 'calculus', kind: 'short', points: 4 },
];

export const QUESTION_COUNT = BANDS[BANDS.length - 1].to;

export const PAPER: readonly PaperQuestion[] = Array.from({ length: QUESTION_COUNT }, (_, i) => {
  const no = i + 1;
  const band = BANDS.find((b) => no <= b.to)!;
  return { no, section: band.section, kind: band.kind, points: band.points };
});

export const FULL_SCORE = PAPER.reduce((sum, q) => sum + q.points, 0);

export function paperQuestion(no: number): PaperQuestion | undefined {
  return Number.isInteger(no) ? PAPER[no - 1] : undefined;
}

export function isQuestionNo(no: number): boolean {
  return paperQuestion(no) !== undefined;
}

export function sectionOf(no: number): Section {
  return paperQuestion(no)?.section ?? 'common';
}

/** 구간 만점. 공통 74 · 미적분 26. */
export function sectionFull(section: Section): number {
  return PAPER.filter((q) => q.section === section).reduce((sum, q) => sum + q.points, 0);
}

/** 번호 구간을 사람이 읽는 한 줄로. "1–22 공통 · 23–30 미적분" — 표에서 만들어 안내가 거짓말이 안 되게 한다. */
export function paperSummary(): string {
  return SECTION_LIST.map((s) => {
    const nos = PAPER.filter((q) => q.section === s).map((q) => q.no);
    return `${nos[0]}–${nos[nos.length - 1]} ${SECTIONS[s]}`;
  }).join(' · ');
}

/** 5지선다는 1–5, 단답형은 0–999. */
export const ANSWER_RANGE: Record<Kind, { min: number; max: number }> = {
  choice: { min: 1, max: 5 },
  short: { min: 0, max: 999 },
};

/** 이 번호에 이 값이 답으로 올 수 있는가. 정답표 · 학생 답 · 사진에서 읽은 값을 모두 여기서 거른다. */
export function isValidAnswer(no: number, value: unknown): value is number {
  const q = paperQuestion(no);
  if (!q || typeof value !== 'number' || !Number.isInteger(value)) return false;
  const { min, max } = ANSWER_RANGE[q.kind];
  return value >= min && value <= max;
}

/**
 * 폼에서 온 글자를 답으로. 비었거나 맞지 않으면 null.
 * "③" · "3번" 처럼 적어도 받는다 — 동그라미 숫자는 5지선다를 적을 때 흔히 나온다.
 */
export function parseAnswer(no: number, raw: string | null | undefined): number | null {
  const text = String(raw ?? '')
    .trim()
    .replace(/[①②③④⑤]/g, (c) => String('①②③④⑤'.indexOf(c) + 1))
    .replace(/번$/, '');
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return isValidAnswer(no, value) ? value : null;
}

/** 답을 화면에 적는 모양. 5지선다는 동그라미 숫자로 — 단답형 3 과 5지선다 ③ 이 헷갈리지 않게. */
export function fmtAnswer(no: number, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (paperQuestion(no)?.kind === 'choice' && value >= 1 && value <= 5) return '①②③④⑤'[value - 1];
  return String(value);
}

/* ─────────────────────────────────────────────────────────── 단원 */

export const UNIT_GROUPS = {
  math1: '수학Ⅰ',
  math2: '수학Ⅱ',
  calculus: '미적분',
} as const;
export type UnitGroup = keyof typeof UNIT_GROUPS;
export const UNIT_GROUP_LIST = Object.keys(UNIT_GROUPS) as UnitGroup[];

export type Unit = { code: string; group: UnitGroup; label: string };

/**
 * 단원. 순서가 곧 화면 순서이고 교과서 순서를 따른다.
 *
 * 단원은 회차마다 문항에 붙이는 **선택** 정보다. 수능형 시험지는 번호만으로 단원이
 * 정해지지 않고(공통 1–22 는 수학Ⅰ·Ⅱ 가 섞여 나온다), 정답표 사진에도 대개 없다.
 * 안 붙인 문항은 단원 집계에서만 빠지고 점수에는 그대로 들어간다.
 *
 * 이미 쓰인 코드는 지우지 않는다 — 그 코드로 저장된 문항이 미아가 된다.
 */
export const UNITS: readonly Unit[] = [
  { code: 'm1_explog', group: 'math1', label: '지수함수와 로그함수' },
  { code: 'm1_trig', group: 'math1', label: '삼각함수' },
  { code: 'm1_seq', group: 'math1', label: '수열' },
  { code: 'm2_limit', group: 'math2', label: '함수의 극한과 연속' },
  { code: 'm2_diff', group: 'math2', label: '미분' },
  { code: 'm2_integ', group: 'math2', label: '적분' },
  { code: 'c_seqlim', group: 'calculus', label: '수열의 극한' },
  { code: 'c_diff', group: 'calculus', label: '미분법' },
  { code: 'c_integ', group: 'calculus', label: '적분법' },
] as const;

const UNIT_BY_CODE = new Map(UNITS.map((u) => [u.code, u]));

export function findUnit(code: string | null | undefined): Unit | undefined {
  return code ? UNIT_BY_CODE.get(code) : undefined;
}

export function unitLabel(code: string | null | undefined): string {
  if (!code) return '단원 미정';
  return UNIT_BY_CODE.get(code)?.label ?? code;
}

/** 이 번호에 붙일 수 있는 단원. 공통 문항에 미적분 단원을 붙이면 집계가 어긋난다. */
export function unitsFor(no: number): Unit[] {
  const calculus = sectionOf(no) === 'calculus';
  return UNITS.filter((u) => (u.group === 'calculus') === calculus);
}

export function unitFits(no: number, code: string | null | undefined): boolean {
  return Boolean(code) && unitsFor(no).some((u) => u.code === code);
}

/* ─────────────────────────────────────────────────────────── 상태 */

export const COURSE_STATUS = { active: '진행 중', archived: '종료' } as const;
export type CourseStatus = keyof typeof COURSE_STATUS;
export const COURSE_STATUSES = Object.keys(COURSE_STATUS) as CourseStatus[];
export function isCourseStatus(v: string): v is CourseStatus {
  return v in COURSE_STATUS;
}

export const USER_STATUS = { active: '사용 중', suspended: '정지' } as const;
export type UserStatus = keyof typeof USER_STATUS;

/**
 * 회차 · 응시의 공개 상태. 값은 같고 뜻이 다르다.
 *   회차  draft 준비 중 · published 학생에게 열림 (학생이 사진과 질문을 올릴 수 있다)
 *   채점  draft 비공개  · published 점수 공개
 * 채점 도중의 반쪽짜리 점수가 학생에게 보이면 안 되므로 둘 다 공개여야 점수가 보인다.
 */
export type PublishStatus = 'draft' | 'published';
export function isPublishStatus(v: string): v is PublishStatus {
  return v === 'draft' || v === 'published';
}
export const EXAM_STATUS: Record<PublishStatus, string> = { draft: '준비 중', published: '학생에게 열림' };
export const GRADE_STATUS: Record<PublishStatus, string> = { draft: '비공개', published: '점수 공개' };

/* ─────────────────────────────────────────────────────── 질문과 답 */

export const CONCERN = {
  /** 학생 질문 한 개의 최대 길이. DB 도 같은 값으로 막는다 (0015). */
  maxBody: 2000,
  /** 튜터 답 한 개의 최대 길이 */
  maxAnswer: 8000,
  /** 문항 번호 대신 '시험 전체' 를 가리키는 자리 */
  wholeExam: 0,
} as const;

/** 0 → "시험 전체", 21 → "21번" */
export function concernTopic(no: number): string {
  return no === CONCERN.wholeExam ? '시험 전체' : `${no}번`;
}

export function isConcernTopic(no: number): boolean {
  return no === CONCERN.wholeExam || isQuestionNo(no);
}

/** 질문을 늘어놓는 순서. 문항 순서대로, '시험 전체' 는 맨 뒤. */
export function concernOrder(a: number, b: number): number {
  const key = (n: number) => (n === CONCERN.wholeExam ? QUESTION_COUNT + 1 : n);
  return key(a) - key(b);
}

/* ─────────────────────────────────────────────────────────── 상수 */

export const LMS = {
  /** 로그인 유지 기간(일). 기존 관리자 잠금(7일)보다 길게 준다 — 학생이 매주 다시 치기엔 번거롭다. */
  sessionDays: 30,
  /** 발급 비밀번호 최소 길이. 관리자가 만들어 주는 값이라 짧게 두지 않는다. */
  minPasswordLength: 8,
  /** 로그인 아이디에 허용하는 글자. 한글 아이디는 기기마다 입력이 달라져서 막는다. */
  loginIdPattern: /^[a-z0-9._-]{4,32}$/,
  /** 답 달 기한의 기본값 — 시험일로부터 며칠 뒤. 수업이 주 1회라 다음 수업 날이다. */
  replyDays: 7,
  /** 한 응시에 올릴 수 있는 시험지 사진 수. 문제지 · 답안지 · 풀이 종이를 합쳐도 넉넉하다. */
  maxPhotos: 24,
  /** 사진 한 장의 상한(바이트). 긴 변 2000px JPEG 는 1MB 안팎이라 넉넉하다. 서버 함수 상한(6MB)보다 작아야 한다. */
  maxPhotoBytes: 5 * 1024 * 1024,
} as const;

/**
 * 사진 올리기가 실패했을 때 화면이 할 말. 서버(lib/lms/upload.ts · 서버 함수)가 코드를 돌려주고
 * 브라우저 부품이 이 표로 말을 고른다 — 양쪽이 따로 적으면 언젠가 말이 어긋난다.
 */
export const UPLOAD_MESSAGES: Record<string, string> = {
  NO_FILE: '사진이 비어 있어요. 다시 골라주세요.',
  TOO_BIG: '사진이 너무 커요. 다시 골라주세요.',
  NOT_JPEG: '이 사진은 열 수가 없었어요. 다른 사진으로 올려주세요.',
  TOO_MANY: `사진은 ${LMS.maxPhotos}장까지 올릴 수 있어요.`,
  LOCKED: '선생님이 답을 보낸 시험이라 더는 고칠 수 없어요.',
  NOT_FOUND: '대상을 찾지 못했어요. 새로고침해 주세요.',
  CLOSED: '지금은 이 시험에 올릴 수 없어요.',
  FAILED: '잘 안 올라갔어요. 잠시 뒤에 다시 해주세요.',
};

/** 아이디가 규칙에 맞으면 null, 아니면 이유를 돌려준다. */
export function loginIdProblem(raw: string): string | null {
  const id = raw.trim().toLowerCase();
  if (!id) return '아이디를 적어주세요';
  if (!LMS.loginIdPattern.test(id)) return '영문 소문자·숫자·(. _ -) 4~32자로 적어주세요';
  return null;
}

export function passwordProblem(raw: string): string | null {
  if (!raw) return '비밀번호를 적어주세요';
  if (raw.length < LMS.minPasswordLength) return `${LMS.minPasswordLength}자 이상으로 적어주세요`;
  return null;
}

/** 78.5 → "78.5", 78 → "78". 점수는 소수 첫째 자리까지만 보여준다. */
export function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 0.8235 → "82%" */
export function fmtRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "2026-09-24" → "9월 24일". 달력 날짜만 다루므로 시차를 타지 않는다. */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : date;
}

/** "2026-09-17" + 7 → "2026-09-24". 달력 계산이라 UTC 로 센다(시각이 없으니 어긋날 일이 없다). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
