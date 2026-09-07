-- ============================================================================
-- 0008 — LMS (/lms)
--
-- 기존 두 흐름(/apply 접수, /class 모집)은 한 번 받고 끝난다. 여기는 반대로 쌓인다.
-- 같은 학생이 회차를 거듭하며 어느 영역이 어떻게 움직였는지가 이 서비스의 물건이라,
-- 표를 나눌 때 기준은 '무엇이 반복되는가' 하나다.
--
--   lms_users            사람 (관리자 · 튜터 · 학생)      — 안 반복됨
--   lms_courses          반                               — 안 반복됨
--   lms_exams            시험 회차                        — 반마다 반복
--   lms_exam_questions   문항표 (번호 · 영역 · 배점)      — 회차마다 한 벌
--   lms_attempts         학생 한 명의 한 회차             — 학생 × 회차
--   lms_answers          문항 하나의 정오                 — 응시 × 문항
--
-- 점수를 숫자로 받지 않고 문항 정오로 받는 이유: 영역별 득점 · 정답률 · 오답 문항이
-- 전부 여기서 계산돼 나온다. 영역 점수만 받으면 '어느 문항을 틀렸나' 는 영영 없다.
--
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번. 여러 번 돌려도 안전하다.
-- ============================================================================

-- ------------------------------------------------------------------ 1. 사람
-- 비밀번호는 scrypt 해시로만 들어간다 (src/lib/lms/auth.ts). 평문은 어디에도 안 남는다.
create table if not exists lms_users (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('admin','tutor','student')),
  -- 소문자로만 저장한다. 앱에서 내려 보내고, 아래 인덱스가 대소문자 섞인 중복도 막는다.
  login_id      text not null,
  password_hash text not null,
  name          text not null,
  phone         text,
  email         text,
  status        text not null default 'active' check (status in ('active','suspended')),
  -- 관리자가 만들어 준 첫 비밀번호로 들어온 사람은 바꾸고 나서야 다른 화면으로 간다.
  must_change_password boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists lms_users_login_idx on lms_users (lower(login_id));
create index if not exists lms_users_role_idx on lms_users (role, name);

-- ------------------------------------------------------------- 2. 학생 부가
-- lms_users 와 1:1. 학생에게만 있는 값을 사람 표에 섞지 않는다 —
-- 튜터 행에 선택과목 칸이 늘 비어 있는 표는 읽을 때마다 헷갈린다.
create table if not exists lms_students (
  user_id      uuid primary key references lms_users(id) on delete cascade,
  grade        smallint check (grade between 1 and 3),
  school       text,
  -- 화작/언매. 이 값에 따라 채점에서 남의 선택과목 문항이 통째로 빠진다.
  elective     text check (elective in ('speech','media')),
  parent_phone text,
  -- /apply 접수번호 (F0902-013). 시험지 피드백으로 처음 만난 학생을 이어 붙인다.
  -- submissions 는 보관기간이 지나면 지워지므로 외래키로 묶지 않고 번호만 적어 둔다.
  receipt_no   text,
  memo         text
);

create index if not exists lms_students_receipt_idx on lms_students (receipt_no);

-- -------------------------------------------------------------------- 3. 반
create table if not exists lms_courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- 모집 페이지(/class)의 반과 이어 붙일 때 쓴다. 안 이어도 된다.
  class_id   uuid references classes(id) on delete set null,
  tutor_id   uuid references lms_users(id) on delete restrict,
  status     text not null default 'active' check (status in ('active','archived')),
  memo       text,
  created_at timestamptz not null default now()
);

create index if not exists lms_courses_tutor_idx on lms_courses (tutor_id, status);

-- ------------------------------------------------------------------ 4. 수강
create table if not exists lms_enrollments (
  course_id  uuid not null references lms_courses(id) on delete cascade,
  student_id uuid not null references lms_users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (course_id, student_id)
);

create index if not exists lms_enrollments_student_idx on lms_enrollments (student_id);

-- ------------------------------------------------------------- 5. 시험 회차
create table if not exists lms_exams (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references lms_courses(id) on delete cascade,
  title      text not null,                -- 1주차 · 이감 파이널 3회
  exam_date  date,
  status     text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now()
);

create index if not exists lms_exams_course_idx on lms_exams (course_id, exam_date desc, created_at desc);

-- ------------------------------------------------------------- 6. 문항표
-- 회차마다 한 벌. 여기 영역과 배점이 있어야 학생별 O/X 가 영역 점수로 접힌다.
create table if not exists lms_exam_questions (
  id        uuid primary key default gen_random_uuid(),
  exam_id   uuid not null references lms_exams(id) on delete cascade,
  no        smallint not null check (no between 1 and 100),
  area_code text not null,                     -- src/config/lms.ts 의 AREAS 코드
  points    numeric(4,1) not null default 2 check (points >= 0),
  answer    smallint check (answer between 1 and 5),
  -- 지문 묶음 표시. "(가)(나)" 처럼 적어 두면 같은 지문 문항이 화면에서 붙어 보인다.
  passage   text,
  unique (exam_id, no)
);

create index if not exists lms_exam_questions_exam_idx on lms_exam_questions (exam_id, no);

-- -------------------------------------------------------------- 7. 응시
-- 학생 한 명의 한 회차. 총평과 공개 여부가 여기 붙는다.
create table if not exists lms_attempts (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references lms_exams(id) on delete cascade,
  student_id      uuid not null references lms_users(id) on delete cascade,
  -- 응시 시점의 선택과목. lms_students 의 값을 베껴 둔다 — 학생이 나중에 화작에서
  -- 언매로 바꿔도 지난 회차의 채점 결과가 뒤늦게 달라지면 안 된다.
  elective        text check (elective in ('speech','media')),
  overall_comment text,
  status          text not null default 'draft' check (status in ('draft','published')),
  updated_at      timestamptz not null default now(),
  unique (exam_id, student_id)
);

create index if not exists lms_attempts_student_idx on lms_attempts (student_id, updated_at desc);

-- --------------------------------------------------------- 8. 문항별 정오
-- 안 푼 문항은 행이 없다. 'false(틀림)' 와 '아직 안 매김' 을 구별해야
-- 채점을 하다 만 회차에서 점수가 0점으로 보이지 않는다.
create table if not exists lms_answers (
  attempt_id  uuid not null references lms_attempts(id) on delete cascade,
  question_id uuid not null references lms_exam_questions(id) on delete cascade,
  correct     boolean not null,
  chosen      smallint check (chosen between 1 and 5),
  primary key (attempt_id, question_id)
);

-- --------------------------------------------------------- 9. 영역별 코멘트
create table if not exists lms_area_comments (
  attempt_id uuid not null references lms_attempts(id) on delete cascade,
  area_code  text not null,
  comment    text not null,
  primary key (attempt_id, area_code)
);

-- ============================================================ 10. 잠금 확인
-- 이 표들은 브라우저에서 직접 열지 않는다. 앱이 service_role 키로만 붙고,
-- 그 키는 서버에만 있다 (src/lib/supabase/admin.ts). anon 키는 이 프로젝트에 없다.
-- 그래도 실수로 anon 키가 생겼을 때 표가 통째로 열려 있지 않도록 RLS 를 켜 둔다.
-- service_role 은 RLS 를 우회하므로 앱 동작에는 영향이 없다.
alter table lms_users          enable row level security;
alter table lms_students       enable row level security;
alter table lms_courses        enable row level security;
alter table lms_enrollments    enable row level security;
alter table lms_exams          enable row level security;
alter table lms_exam_questions enable row level security;
alter table lms_attempts       enable row level security;
alter table lms_answers        enable row level security;
alter table lms_area_comments  enable row level security;
