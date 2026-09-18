// LMS 설정 단일 출처. 역할 · 시험지 모양 · 단원 · 상태값이 전부 여기서 나온다.
//
// 여기에는 값 · 문구와, 그 표를 읽는 조회(번호 → 문항 · 단원 이름)와 타입 가드만 둔다.
// 답을 해석하고 검사하는 규칙은 lib/lms/paper.ts, 아이디 · 비밀번호 검사는 lib/lms/credentials.ts,
// 점수 · 날짜 서식은 lib/format.ts 에 있다.
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

/* ─────────────────────────────────────────────────── 사진으로 자동 채점 */

/**
 * 학생 시험지 사진에서 학생이 고른 · 적은 답을 읽어 채점을 채운다 (lib/lms/photo-read.ts · 0016).
 * 모델 호출은 돈이 들고 느리다. 아래 숫자가 언제 · 몇 장씩 · 몇 번 부를지를 정한다.
 */
export const PHOTO_READ = {
  /**
   * 학생이 사진을 올리거나 지운 뒤 이만큼 조용하면 읽기 시작한다. 카메라로 한 장씩 찍어
   * 올리는 동안 매번 읽으면, 앞의 읽기는 다음 사진이 오는 순간 버려진다.
   */
  quietMs: 30_000,
  /** 학생이 제출할 때 읽기가 낡았으면 이만큼 기다렸다 읽는다. */
  submitQuietMs: 5_000,
  /** 학생 쪽 변화로 자동으로 부르는 횟수의 상한. 넘으면 튜터가 '다시 읽기' 로 부른다. */
  maxStudentRuns: 8,
  /** 매일 새벽 정리가 다시 읽어 주는 횟수의 상한. 계속 실패하는 읽기에 돈을 붓지 않게. */
  maxRetryRuns: 12,
  /**
   * 한 번에 모델에게 보내는 사진 수. 긴 변 2000px 사진 한 장이 입력 4천 토큰쯤이라 넷이면
   * 한 요청이 1만 6천 토큰 — 가장 낮은 요금 등급의 분당 한도 안에 든다.
   */
  batchSize: 4,
  /** 동시에 보내는 요청 수 */
  concurrency: 2,
  /**
   * 읽기 한 판에 쓰는 시간 — 사진 받기 · 모든 요청 · 재시도 기다림을 합친 것. 서버 함수 상한
   * (300초)에서 조용히 기다리는 몫(quietMs)과 결과를 적을 몫을 뺐다.
   */
  budgetMs: 230_000,
  /** 요청 한 번에 주는 시간의 상한 */
  callTimeoutMs: 180_000,
  /** 남은 시간이 이보다 짧으면 새 요청을 보내지 않는다 — 보내 봐야 끝나기 전에 끊긴다. */
  minCallMs: 20_000,
  /** 끝에 남겨 두는 시간. 실패든 결과든 DB 에 적을 몫이다. */
  reserveMs: 10_000,
  /** 요청 한 번이 실패했을 때 다시 보내는 횟수 (요청 몰림 · 서버 오류 · 연결 끊김) */
  maxRetries: 2,
  /** 이보다 오래 '읽는 중' 이면 멈춘 것으로 본다 (서버가 중간에 끊긴 경우). */
  stuckMs: 10 * 60_000,
} as const;

/** 읽기가 실패했을 때 튜터 화면이 할 말. 코드는 lib/lms/ocr.ts · photo-read.ts 가 적는다. */
export const PHOTO_READ_ERRORS: Record<string, string> = {
  NOT_CONFIGURED: 'ANTHROPIC_API_KEY 가 없어 사진을 읽을 수 없어요.',
  NO_IMAGE: '읽을 사진이 없어요.',
  REFUSED: '모델이 이 사진을 읽지 않겠다고 했어요. 직접 매겨 주세요.',
  UNREADABLE: '사진에서 답을 옮기지 못했어요. 다시 읽어도 안 되면 직접 매겨 주세요.',
  BAD_KEY: 'ANTHROPIC_API_KEY 가 맞지 않아요.',
  RATE_LIMIT: '요청이 몰려 잠시 막혔어요. 조금 뒤에 다시 읽어 주세요.',
  API_ERROR: 'Claude 쪽 오류로 읽지 못했어요. 조금 뒤에 다시 읽어 주세요.',
  TIMEOUT: '시간 안에 다 읽지 못했어요. 다시 읽어 주세요.',
  FILE: '저장된 사진을 불러오지 못했어요. 다시 읽어 주세요.',
  PHOTOS_CHANGED: '읽는 사이 학생이 사진을 바꿨어요. 다시 읽어 주세요.',
  UNKNOWN: '알 수 없는 이유로 읽지 못했어요. 다시 읽어 주세요.',
};

/** 다시 부르면 나아질 수 있는 실패. 매일 새벽 정리가 이것만 다시 읽는다. */
export const PHOTO_READ_RETRYABLE: readonly string[] = [
  'RATE_LIMIT',
  'API_ERROR',
  'TIMEOUT',
  'FILE',
  'PHOTOS_CHANGED',
  'UNKNOWN',
];

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
