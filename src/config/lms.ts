// LMS 설정 단일 출처. 역할 · 국어 영역 분류 · 상태값이 전부 여기서 나온다.
//
// 기존 서비스(/apply, /class)가 '한 번 보내고 끝나는' 접수라면 LMS(/lms)는 '쌓이는' 쪽이다.
// 수업이 회차를 거듭할수록 같은 학생의 같은 영역이 어떻게 움직였는지가 상품이므로,
// 영역 코드는 한번 정하면 바꾸지 않는다 — 코드를 바꾸면 과거 데이터와 이어지지 않는다.

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

/* ─────────────────────────────────────────────────────── 선택과목 */

export const ELECTIVES = {
  speech: '화법과작문',
  media: '언어와매체',
} as const;
export type Elective = keyof typeof ELECTIVES;
export const ELECTIVE_LIST = Object.keys(ELECTIVES) as Elective[];

export function isElective(v: string): v is Elective {
  return v in ELECTIVES;
}

/* ─────────────────────────────────────────────────────────── 영역 */

export const AREA_GROUPS = {
  reading: '독서',
  literature: '문학',
  elective: '선택과목',
} as const;
export type AreaGroup = keyof typeof AREA_GROUPS;
export const AREA_GROUP_LIST = Object.keys(AREA_GROUPS) as AreaGroup[];

export type Area = {
  code: string;
  group: AreaGroup;
  label: string;
  /**
   * 선택과목 영역만 값이 있다. 학생이 고른 선택과목과 다른 영역의 문항은
   * 그 학생 채점에서 통째로 빠진다 — 화작 학생에게 언매 11문항을 틀린 것으로
   * 세면 점수도 영역별 정답률도 전부 거짓말이 된다.
   */
  elective?: Elective;
};

/**
 * 영역 목록. 순서가 곧 화면 순서이고, 시험지에 나오는 순서(독서 → 문학 → 선택)를 따른다.
 *
 * 갈래복합처럼 영역을 하나 더 열어야 하면 여기 한 줄만 더하면 된다 —
 * 문항표 화면 · 집계 · 학생 화면이 전부 이 배열만 본다.
 * 반대로 이미 쓰인 영역 코드를 지우면 그 코드로 저장된 과거 문항이 미아가 되므로 지우지 않는다.
 */
export const AREAS: readonly Area[] = [
  { code: 'read_theory', group: 'reading', label: '독서론' },
  { code: 'read_humanities', group: 'reading', label: '인문' },
  { code: 'read_social', group: 'reading', label: '사회' },
  { code: 'read_science', group: 'reading', label: '과학기술' },
  { code: 'lit_modern_poem', group: 'literature', label: '현대시' },
  { code: 'lit_modern_novel', group: 'literature', label: '현대소설' },
  { code: 'lit_classic_poem', group: 'literature', label: '고전시가' },
  { code: 'lit_classic_novel', group: 'literature', label: '고전소설' },
  { code: 'el_speech', group: 'elective', label: '화법과작문', elective: 'speech' },
  { code: 'el_media', group: 'elective', label: '언어와매체', elective: 'media' },
] as const;

const AREA_BY_CODE = new Map(AREAS.map((a) => [a.code, a]));

export function findArea(code: string): Area | undefined {
  return AREA_BY_CODE.get(code);
}

export function areaLabel(code: string): string {
  return AREA_BY_CODE.get(code)?.label ?? code;
}

export function isAreaCode(v: string): boolean {
  return AREA_BY_CODE.has(v);
}

/** 이 선택과목 학생에게 보여줄 영역만. 남의 선택과목 영역은 빼고 준다. */
export function areasFor(elective: Elective | null): Area[] {
  return AREAS.filter((a) => !a.elective || a.elective === elective);
}

/** 화면에서 묶어 그릴 때 쓴다. 빈 묶음은 넣지 않는다. */
export function groupedAreas(elective: Elective | null): { group: AreaGroup; label: string; areas: Area[] }[] {
  return AREA_GROUP_LIST.map((group) => ({
    group,
    label: AREA_GROUPS[group],
    areas: areasFor(elective).filter((a) => a.group === group),
  })).filter((g) => g.areas.length > 0);
}

/* ─────────────────────────────────────────────────────────── 상태 */

export const COURSE_STATUS = { active: '진행중', archived: '종료' } as const;
export type CourseStatus = keyof typeof COURSE_STATUS;
export const COURSE_STATUSES = Object.keys(COURSE_STATUS) as CourseStatus[];
export function isCourseStatus(v: string): v is CourseStatus {
  return v in COURSE_STATUS;
}

export const USER_STATUS = { active: '사용중', suspended: '정지' } as const;
export type UserStatus = keyof typeof USER_STATUS;

/**
 * 시험 회차 · 응시 기록의 공개 상태.
 * draft 는 튜터만 본다 — 채점 도중의 반쪽짜리 점수가 학생에게 보이면 안 된다.
 */
export const PUBLISH_STATUS = { draft: '작성중', published: '공개' } as const;
export type PublishStatus = keyof typeof PUBLISH_STATUS;
export function isPublishStatus(v: string): v is PublishStatus {
  return v in PUBLISH_STATUS;
}

/* ─────────────────────────────────────────────────────────── 상수 */

export const LMS = {
  /** 로그인 유지 기간(일). 기존 관리자 잠금(7일)보다 길게 준다 — 학생이 매주 다시 치기엔 번거롭다. */
  sessionDays: 30,
  /** 발급 비밀번호 최소 길이. 관리자가 만들어 주는 값이라 짧게 두지 않는다. */
  minPasswordLength: 8,
  /** 로그인 아이디에 허용하는 글자. 한글 아이디는 기기마다 입력이 달라져서 막는다. */
  loginIdPattern: /^[a-z0-9._-]{4,32}$/,
  /** 국어 한 회차 기본 문항 수. 문항표를 새로 만들 때 이만큼 줄이 깔린다. */
  defaultQuestionCount: 45,
  /** 문항표가 가질 수 있는 최대 문항 수. 실수로 수천 줄이 깔리는 것만 막는 상한이다. */
  maxQuestionCount: 100,
  /** 한 회차 만점. 문항표 배점 합이 이 값과 다르면 화면이 경고만 하고 막지는 않는다. */
  fullScore: 100,
} as const;

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
