# KSAT-Feedback

9모 시험지 피드백 접수 사이트. 스펙은 `../PRD_9모_시험지_피드백.md` (v1.0).

시험지 사진 한 장으로 시작하는 무료 피드백 접수 창구. **하드 데드라인 2026-09-02(수) 접수 오픈.**

## 돌려보기

```bash
npm install
npm run dev            # http://localhost:3000
```

Supabase 키가 없어도 ②단계까지 전부 동작한다. 환경변수가 비어 있으면 업로드가 **mock 모드**로 떨어져
서명 URL 발급·업로드를 흉내낸다. 파일 이름에 `fail` 이 들어가면 일부러 실패시켜서 FE-4 실패 UI를 볼 수 있다.

실제 스토리지에 붙이려면 `.env.example` 을 `.env.local` 로 복사하고 값을 채운 뒤,
`supabase/migrations/0001_init.sql   스키마·RLS·버킷·제출 함수
supabase/migrations/0002_worker.sql 워커용 컬럼·실패 로그·claim 함수` 을 Supabase SQL Editor 에서 실행한다.

## 지금까지 된 것 (8/29 기준)

| 항목 | 상태 |
|---|---|
| FE-1 4단계 진행 표시 · 되돌아가기 · 상태 일관성 | 됨 |
| FE-2 시험 선택 ① (선택 즉시 다음, 상단 요약 유지) | 됨 |
| FE-3 과목 칩 + 과목별 업로드 섹션 ② (과목당 12장·국어 16장/전체 40장 상한, 삭제·순서 변경) | 됨 |
| FE-4 업로드 상태 피드백 (장별 진행률, `3장 중 2장`, 장별 재시도) | 됨 |
| FE-5 과목별 고민 ③ (설정 파일 렌더링, 순차 진행, 건너뛰기 확인) | 됨 |
| FE-6 이메일 + 동의 ④ (포커스아웃 검사, 오타 도메인 제안, 연타 방지) | 됨 |
| FE-7 완료 화면 (접수번호·회신 예정일·요약, 새로고침 유지) | 됨 |
| FE-8 이어하기 (localStorage 자동 저장 + 랜딩 복귀 배너, 제출 후 삭제) | 됨 |
| FE-9 모바일 우선 (360px 가로 스크롤 없음, 하단 고정 버튼 48px+) | 됨 |
| BE-1 이미지 정규화 (긴 변 2000px / JPEG q0.82) + 서명 URL 직접 업로드 | 됨 (mock 폴백) |
| BE-2 제출 (원자적 생성 · 접수번호 발급 · 멱등키) | 됨 |
| OPS-1 접수 스위치 (전체/과목별 on/off, 상한, 마감 화면) | 됨 (Supabase 한 줄로 조작) |
| 데이터 모델 · RLS · 비공개 버킷 · 설치 점검 함수 | SQL 작성 완료, **실행은 수동** |
| BE-3 과목별 PDF 병합 | 됨 (세로·가로 섞여도 잘리지 않음, 파일명은 영문 — 아래 참고) |
| BE-5 Notion 자동 등록 | 됨 (과목 1건 = 페이지 1개, 재실행해도 중복 안 생김) |
| P1-1 접수 확인 메일 | 됨 (Gmail SMTP, 발신 juhhyun10031@gmail.com) |
| SEC-1 보관 기간 지난 사진·PDF 자동 삭제 | 됨 (하루 한 번 크론) |
| P1-4 퍼널 계측 (Vercel Web Analytics) | 붙임 — 대시보드에서 켜야 집계 시작 |
| P1 (접수 확인 메일, 품질 힌트, 퍼널 계측, 스팸 방지) | **없음** |

## 구조

파일마다 무슨 일을 하는지 한 줄로 붙여 뒀다. `★` 는 실제로 손대게 되는 곳.

```
src/app/                          화면과 API — 폴더 이름이 그대로 주소가 된다
  layout.tsx               36     모든 화면 공통 껍데기 · 폰트 · 480px 모바일 폭
  globals.css              57     색·여백 등 전체 스타일 변수
  page.tsx                 88  ★  랜딩 (제목 · 배지 · 시험지 보내기 버튼)

  apply/                          접수 4단계
    layout.tsx             48     상단 진행 표시 · 단계 건너뛰기 방지
    exam/page.tsx          74     ① 시험 선택
    upload/page.tsx        83     ② 과목 선택 + 시험지 사진 업로드
    concerns/page.tsx      22        첫 과목으로 넘겨주는 중계
    concerns/[subject]/
      page.tsx            352  ★  ③ 원점수 + 고민 문항 (과목마다 반복)
    email/page.tsx        188  ★  ④ 이메일 + 동의 + 제출

  done/[receiptNo]/
    page.tsx              109  ★  완료 화면 (접수번호 · 회신 예정일 · 문의 메일)

  class/                          모집 페이지 — 9모 피드백 받은 학생에게 유료 수업을 알린다
    page.tsx                       화면 배치만. 글자는 config/class-copy.ts 에 있다
    opengraph-image.png            카톡·메일 링크 미리보기 카드 (1200×630)
    [slug]/apply/page.tsx          신청 폼 네 칸
    [slug]/apply/done/page.tsx     완료 — 계좌 대신 "카카오톡 드릴게요"

  admin/                          관리자 (ADMIN_PASSWORD 로 잠금, noindex)
    login/page.tsx                 비밀번호 한 칸
    actions.ts                     쓰기 전부. 맨 앞에서 assertAdmin()
    (guarded)/page.tsx             클래스 목록
    (guarded)/class/new           ·[slug]/page.tsx  반 만들기 · 고치기 · 증빙 업로드
    (guarded)/applications         신청자 목록 · 상태 옮기기

  setup/page.tsx           83     설치 점검 ✓/✗ (운영자용, noindex, 같은 잠금)

  api/                            브라우저가 부르는 서버 주소
    upload-url/route.ts    57     사진 올릴 일회용 서명 주소 발급
    submit/route.ts       146  ★  접수 저장 → 접수번호 발급 → 후처리 시작
    intake/route.ts        11     접수 열림/닫힘 조회
    health/route.ts         9     설치 점검 결과 (/setup 이 읽는다)
    worker/                       자물쇠 걸린 운영용 — WORKER_SECRET 헤더 필요
      cron/route.ts        50     매일 03:00(KST) 자동 정리
      process/route.ts     39     막힌 접수 다시 처리
      purge/route.ts       51     보관 기간 지난 파일 삭제 · 접수 통째 삭제
      storage/route.ts     59     저장소에 쌓인 양 확인 · 주인 없는 사진 삭제
      status/route.ts     100     무엇이 왜 막혔는지 진단 (?probe=1, ?mail=1)

src/config/                       문구·숫자만 들어 있다. 여기부터 고친다
  questions.config.ts     196  ★  ③단계 고민 문항 — 공통 5문항 · 국어 8문항
  app.ts                   63  ★  장수 상한 · 회신 SLA · 보관 기간 · 문의 메일 · 기능 플래그
  exams.ts                 63     시험 3종 → 학년과 과목이 여기서 결정된다
  subjects.ts              40     과목 코드 ↔ 라벨 (math ↔ 수학) · 원점수 만점
  steps.ts                 20     4단계 이름

src/components/                   여러 화면이 함께 쓰는 조각
  UploadSection.tsx       247  ★  사진 업로드 — 장별 진행률 · 재시도 · 순서 변경
  ProgressSteps.tsx        62     상단 4단계 표시
  SubjectChips.tsx         40     과목 선택 칩
  BottomBar.tsx            34     화면 아래 고정 버튼
  AutoTextarea.tsx         34     글 길이만큼 늘어나는 입력칸
  ExamSummary.tsx          21     상단 "고3 · 9월 모평 · 바꾸기"
  Analytics.tsx            23     방문 통계 — 완료 화면 주소의 접수번호는 잘라내고 보낸다

src/lib/                          화면 뒤에서 도는 로직
  store.ts                245  ★  입력값 보관 · 자동 저장 (이어하기)
  image.ts                 64     사진을 긴 변 2000px · JPEG 로 줄인다
  upload.ts                73     서명 주소로 실제 전송
  submit.ts                42     제출 payload 조립
  email.ts                 70     이메일 형식 검사 · 오타 도메인 제안
  flow.ts                  22     사진이 있는 과목만 골라낸다
  draft.ts blobs.ts id.ts         임시 id · 재시도용 사진 보관
  useIntake.ts             55     접수 열림 여부 조회 (브라우저)
  intake.ts                48     접수 스위치 읽기 (서버 전용)
  health.ts               167     설치 점검 13항목 (서버 전용)
  supabase/admin.ts        18     DB 접속 — 마스터 키는 이 파일에서만 쓴다

src/lib/worker/                   접수 뒤에 자동으로 도는 것들 (전부 서버 전용)
  process.ts              309  ★  전체 지휘 — PDF → Notion → 확인 메일
  notion.ts               223     Notion 페이지 생성 · 본문에 문답 기록 · 429 대기
  purge.ts                133     파일 · DB 기록 · Notion 페이지 삭제
  storage.ts              150     저장소 훑기 · 주인 없는 사진 정리 · 버킷 비우기
  mail.ts                 101     접수 확인 메일 (Gmail SMTP)
  pdf.ts                   57     사진 여러 장을 PDF 한 개로

src/lib/ (모집 페이지)
  admin.ts                        관리자 잠금 — 비밀번호 → HMAC 서명 쿠키
  classes.ts                      개설 클래스 · 신청 읽기/쓰기 · 증빙 서명 URL
  class-mail.ts                   신청 들어오면 팀에게 알림 메일
src/config/class.ts               수강료 기본값 · 보유기간 · 접수번호·연락처 형식
src/config/class-copy.ts        ★ 모집 페이지에 나오는 글자 전부. *별표* 는 빨간 밑줄, \n 은 줄바꿈
src/components/ClassMeta.tsx      반 정보(일정·기간·장소·튜터)를 이름표 붙여 줄로 나눈다
src/components/PriceBlock.tsx     총액 + 무엇이 포함되는지 체크 목록. 카드·신청 화면이 함께 쓴다
src/components/Reveal.tsx         스크롤하면 한 덩어리씩 떠오른다 (html.js 없으면 그냥 보인다)

supabase/migrations/              데이터베이스 설계도 — SQL Editor 에 붙여넣는 것
  0001_init.sql           211     표 · RLS · 비공개 버킷 · 접수번호 발급 함수
  0002_worker.sql         103     실패 기록표 · 재처리 함수 · 설치 점검 함수
  0003_daily_cap.sql      148     하루 접수 상한 (한국 날짜 기준, 자정에 초기화)
  0004_raw_score.sql      139     과목 원점수 칸 · 저장
  0005_classes.sql                개설 클래스 · 수업 신청 · 튜터 증빙 버킷

docs/                             아티팩트로 공유한 문서
  setup-checklist.html            준비 체크리스트
  report.html                     개발 완료 보고
  feedback-line.html              피드백 생산 방식 검토
  math-samples.html               수학 피드백 예시 5장
  class-180.html                  3시간 수업 구조 정의서 (튜터용)
  class-landing-prd.html          모집 페이지 설계서 (PRD v1.1)

.env.example                      필요한 환경변수 목록 (실제 값은 Vercel 에)
vercel.json                       매일 03:00(KST) 크론 설정
```

### 무엇을 바꾸려면 어디를 여나

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 고민 문항 문구 · 순서 · 선택지 (국어는 별도 묶음) | `src/config/questions.config.ts` |
| 원점수 만점 (과목별) | `src/config/subjects.ts` |
| 회신 기한 · 사진 장수 상한 · 문의 메일 | `src/config/app.ts` |
| 시험 종류 · 과목 구성 | `src/config/exams.ts` |
| 랜딩 제목 · 배지 | `src/app/page.tsx` |
| 완료 화면 문구 | `src/app/done/[receiptNo]/page.tsx` |
| 접수 확인 메일 내용 | `src/lib/worker/mail.ts` |
| **접수 열기/닫기 · 상한 · 과목별 차단** | 코드 아님 — Supabase `app_settings` 한 줄 |
| **모집 페이지 문구 전부** | `src/config/class-copy.ts` — 이 파일 하나만 열면 된다 |
| 수강료 기본값 · 보유기간 · 180분 구성 | `src/config/class.ts` |
| **개설 클래스 (시간 · 튜터 · 학력 · 수강료 · 정원 · 상태)** | 코드 아님 — `/admin` 에서 고친다 |

## 운영자용 화면

- `/setup` — 무엇이 준비됐고 무엇이 빠졌는지 ✓/✗ 로 보여준다. 배포 후 여기부터 열어볼 것.
  SQL 을 안 돌렸으면 그 항목이 빨갛게 뜨고 어떤 파일을 실행해야 하는지 알려준다.
- `/admin` — 개설 클래스와 신청자. 반 이름·시간·튜터·학력·증빙·수강료·정원·상태를 여기서 고친다.
  **배포 없이 즉시 반영**된다. `ADMIN_PASSWORD` 환경변수 하나로 잠기고, 같은 잠금이 `/setup` 에도 걸린다.
- Supabase Table Editor > `app_settings` 한 줄 — 접수 on/off, 상한, 과목별 off, 마감 문구. **배포 없이 즉시 반영**된다.

## 정해진 값 / 남은 미결

§9 결정 사항은 `src/config/app.ts` 한곳에 모여 있다. 38차 회의에서 아래대로 확정됐다.

| PRD | 결정 | 어디에 |
|---|---|---|
| Q1 | 고1·2 과목 5개 모두 연다 | `subjects.ts` (닫을 땐 `app_settings.disabled_subjects`) |
| Q3 | 하루 100건 (2026-08-30 변경) | `app_settings.daily_capacity` — 배포 없이 숫자만 고친다 |
| Q4 | 사진 보관 30일 | `POLICY.retentionDays` — 동의 문구에 자동 반영 |
| Q5 | 회신 SLA 7일 | `POLICY.replySlaDays` — 완료 화면 날짜에 자동 반영 |
| Q6 | 커스텀 도메인 없이 vercel.app 기본 주소 | `BRANDING.serviceName` 은 페이지 제목에만 쓰임 |
| Q7 | 완료 화면 과외 버튼 끔 | `FEATURES.conversionCta` |

**Q2 확정 (2026-08-29, 서현).** `questions.config.ts` 에 다섯 문항으로 들어갔다 (국어는 2026-08-30 자로 8문항 별도) —
서술형 4 · 문항 목록 1. 전부 선택 입력이고, 하나도 안 적어도 넘어간다. §9 미결은 모두 닫혔다.

문항 번호는 번호만 받지 않고 **번호와 그 이유를 한 쌍으로**, 줄을 추가해 여러 개 받는다(`items` 타입).
답변 값이 문자열만이 아니라 `{ no, why }` 목록도 될 수 있는 이유다.

**국어만 문항이 다르다 (2026-08-30).** 국어는 영역·지문별로 물어볼 것이 달라 공통 문항으로는
필요한 정보가 안 나온다. `CONCERN_QUESTIONS_BY_SUBJECT.korean` 에 여덟 문항이 따로 있고,
나머지 과목은 공통 다섯 문항 그대로다. 보기에서 고르는 `choice` 타입은 여기서 처음 쓰는데,
**같은 보기를 다시 누르면 선택이 풀린다** — 전부 선택 입력인데 한번 누르면 못 되돌리면 곤란해서다.

국어의 문항 번호 예시는 "3페이지 독서지문, 7번" 이라 번호 칸이 숫자만 받으면 안 된다.
숫자 자판 강제를 풀고 칸도 내용에 맞게 늘어나게 두었다.

**원점수는 전 과목 공통**이고 고민 문항이 아니라 별도 칸이다(`submission_subjects.raw_score`).
등급이 아니라 원점수인 이유는 튜터가 시험지를 볼 때 몇 점짜리를 틀렸는지 맞춰봐야 하기 때문이다.
선택 입력이라 채점 전에도 접수할 수 있다. 만점은 과목마다 다르므로(국·수·영 100,
통합과학·통합사회 50) `subjects.ts` 에 두고 화면 안내와 서버 검사가 같은 값을 본다.

운영 쪽 미결: Q8(접수 확인 메일 발송 주체·발신 주소), Q9(Notion DB 를 팀 워크스페이스에 둘지 분리할지).

## 모집 페이지 (/class)

9모 시험지 피드백을 받은 학생에게 유료 수업을 알리는 화면이다. 설계는
`docs/class-landing-prd.html`, 수업 자체의 정의는 `docs/class-180.html` 에 있다.

페이지는 세 덩어리다. **수업 구조**(180분을 80:10:90 으로 쓰는 자와 실제 관찰 기록 네 줄) →
**받는 학생 / 받지 않는 학생** → **지금 열려 있는 반**. 앞의 둘은 코드에 박아 두고,
마지막 하나만 DB 에서 읽는다. 바뀌지 않는 것을 편집 가능하게 만드는 것이 관리 비용이다.

- **읽기** — `/class` 는 서버 컴포넌트가 `supabaseAdmin()` 으로 읽어 그린다(`force-dynamic`).
  `classes` 에는 익명 정책을 만들지 않았다. 브라우저는 Supabase 에 직접 붙지 않는다.
- **신청** — 학생이 채우는 칸은 넷뿐이다: 이름 · 9모 접수번호 · 학부모 연락처 · 동의.
  학년·이메일·그때 적은 고민은 접수번호로 조회한다. 번호가 틀려도 신청은 받고,
  관리자 목록에 `대조 실패` 로만 표시한다 — 번호 하나 때문에 신청을 놓치는 쪽이 더 나쁘다.
- **정원** — 화면과 `create_class_application()` 안에서 두 번 막는다. 화면에서만 막으면
  마지막 자리를 동시에 누른 두 명이 둘 다 통과한다(하루 상한에서 겪은 문제와 같다).
- **결제** — 페이지에 계좌를 올리지 않는다. 신청이 들어오면 팀에게 알림 메일이 가고,
  남겨 준 학부모 번호로 사람이 카카오톡을 보낸다.
- **증빙** — 튜터 성적 증빙은 비공개 버킷 `tutor-proof` 에 넣고 볼 때마다 서명 URL 을 새로 만든다.
  버킷을 공개로 열지 않는 이유는 주소가 한 번 새면 계속 열려 있기 때문이다.
  **올리기 전에 이름·수험번호를 가릴 것.**
- **보관** — 신청 정보는 90일 뒤 크론이 행 자체를 지운다(사진처럼 파일만 지우는 게 아니다).

페이지는 학생이 이미 손에 쥔 것에서 시작한다 — 9월에 보낸 피드백 문서의 소제목을 그대로
보여주고, "그 문서에 못 쓴 게 하나 있다"로 넘어간다.

반 정보와 수강료는 **카드(`/class`)와 신청 화면이 같은 부품을 쓴다**(`ClassMeta` · `PriceBlock`).
한 줄로 이어 붙이면 학생이 필요한 값을 못 찾으므로 이름표를 붙여 줄을 나누고, 수강료는
총액 하나만 크게 두고 무엇이 포함되는지를 바로 아래 체크 목록으로 편다 —
모의고사와 스터디룸이 값에 들어 있다는 사실이 이 반의 가장 강한 근거다.
관리자가 적은 `price_note` 한 줄을 가운뎃점으로 잘라 항목을 만든다.

시험지 사진은 접수일 + 30일에 지워진다. 학생이 적어 준 접수번호로 튜터가 그 시험지를 다시
펴 보려면 그 전에 신청이 들어와야 한다 — 모집 메일을 미룰수록 연결 고리가 한 명씩 사라진다.

## 시트를 빼기로 한 이유 (BE-4 제외)

PRD 는 Supabase(원본) → Google Sheets(사람이 보기 쉬운 사본) → Notion(운영판) 세 갈래였다.
그런데 시트가 맡기로 했던 일이 대부분 다른 곳으로 옮겨갔다.

- `_설정` 탭(접수 on/off·상한·과목 차단) → Supabase `app_settings` 로 이동, 이미 동작 중
- `_실패` 탭(오류 로그) → `submissions.status` + `sheet_ok`/`notion_ok` 로 대체 (워커 작업 때 `sync_failures` 로 정리)
- `접수` 탭 → Notion 과 같은 데이터의 사본

남는 건 사본 하나인데, 그 대가로 구글 클라우드 프로젝트·서비스 계정·JSON 키·시트 공유라는 수동 단계와
비밀 키 하나가 늘어난다. 접수 10~30건 규모에서 시트가 주는 이득(피벗 집계)은 Notion 뷰로 충분히 대신된다.

2026-08-28 사용자 결정으로 **v1 에서 제외**한다. `submissions.sheet_ok` 컬럼은 남겨 둔다 — 나중에 붙일 때
스키마를 다시 건드리지 않기 위해서다. 집계가 필요하면 Supabase Table Editor 의 CSV 내보내기를 쓴다.

G4(자동 반영 성공률)는 Notion 단독 기준으로 읽는다.

## 접수 뒤에 일어나는 일

```
학생 제출 → /api/submit → 접수번호 즉시 반환 (학생 화면은 여기서 끝)
                        ↓ after() — 응답을 보낸 뒤 같은 함수 안에서 이어서
              과목별 사진 → PDF 한 개로 병합 → Storage 저장
              과목별 Notion 페이지 생성 (시험지 PDF 는 만료 있는 서명 URL)
              접수 확인 메일 발송
                        ↓
              전부 성공하면 status = 'synced', 하나라도 실패하면 'failed' + sync_failures 기록
```

- **단계마다 따로 실패를 받는다.** PDF 가 실패해도 Notion 등록과 메일은 나간다.
- **여러 번 돌려도 결과가 같다.** 이미 만든 PDF·Notion 페이지·보낸 메일은 건너뛴다.
- **막힌 접수 되살리기**: `POST /api/worker/process` 를 부르면 밀린 것부터 최대 5건을 다시 처리한다.
  특정 건만 하려면 `?receipt=F0902-013`. `WORKER_SECRET` 을 넣어뒀다면 `x-worker-secret` 헤더가 필요하다.
- `/setup` 이 밀린 건수와 해결 안 된 오류 건수를 같이 보여준다.

## 알아 둘 것

- **초안 경로**: 제출 전에는 접수번호가 없어서 이미지를 `raw/drafts/{draftId}/{과목}/{순번}.jpg` 에 쌓는다.
  PRD 의 `raw/{접수번호}/...` 로 묶는 일은 제출(BE-2) 때 한다.
- **새로고침 후 재시도**: 실패한 장의 원본 blob 은 메모리에만 있다. 새로고침하면 그 장은 다시 고르라고 안내한다.
- **Vercel Web Analytics**: 단계마다 주소가 달라서 페이지뷰만으로 퍼널이 그려진다
  (`/` → `/apply/exam` → `/apply/upload` → `/apply/concerns/[과목]` → `/apply/email` → `/done`).
  완료 화면 주소의 접수번호는 `src/components/Analytics.tsx` 의 `beforeSend` 에서 잘라내고 보낸다.
- **PDF 파일명은 영문이다.** PRD BE-3 은 `{접수번호}_{학년}_{과목}.pdf` 를 한글로 적었지만,
  스토리지 키에 한글을 넣으면 `Invalid key` 로 거부당하고, 다운로드 파일명 파라미터도 서버가
  디코드하지 않아 `%25EA%25B3%25A0…` 로 이중 인코딩된다. `F0902-013_G3_math.pdf` 형태로 간다.
- **막힌 접수 되살리기**: `POST /api/worker/process?receipt=F0902-013` (헤더 `x-worker-secret`).
  사람이 집어서 부르는 것이므로 자동 재시도 한도에 걸려 있어도 풀고 다시 돌린다.
  무엇이 왜 막혔는지는 `GET /api/worker/status` — `?probe=1` 은 저장소에서 사진을 실제로 받아보고,
  `?mail=1` 은 운영자 주소로 시험 메일을 보내본다.
- **장수 상한은 과목마다 다르다.** 기본 12장이고 국어만 16장이다 — 학생 문제지가 실제로 16장이라
  12장으로는 시험지를 다 못 올린다. 숫자는 `config/app.ts` 의 `maxPhotosBySubject` 한 곳에 있고,
  화면·서버·안내 문구가 모두 `maxPhotosFor()` 하나만 본다. 한쪽만 고쳐서 화면은 받아주는데
  서버가 거절하는 사고를 막기 위해서다. 다른 과목도 장수가 다르면 그 표에 한 줄 더하면 된다.
  전체 상한 40장은 그대로다 — 국어 16 + 다른 과목 12 + 12 = 40 이라 세 과목까지는 들어간다.
- **사진 저장 경로는 사진 고유 id 를 쓴다** (`raw/drafts/{초안}/{과목}/{사진id}.jpg`).
  순번을 쓰면 사진을 지웠다 다시 올릴 때 같은 번호가 다시 나와 먼저 올린 파일을 덮어쓴다.
  순서는 제출할 때 `order_index` 로 따로 보낸다.
- **제출 시 경로를 검증한다.** 모든 사진 경로가 그 접수의 초안 id·과목과 맞는지 확인하고,
  같은 경로가 두 번 오면 거절한다. 남의 접수 사진을 끼워 넣거나 같은 장이 PDF 에 두 번 들어가지 않게 한다.
- **하루 한 번 정리**: `vercel.json` 의 크론이 매일 03:00(KST) `/api/worker/cron` 을 부른다.
  ① 밀린 접수 처리 — 제출 직후 후처리가 시간 초과로 잘린 건을 되살린다. 이게 없으면 아무도 다시 돌려주지 않는다.
  ② 보관 기간이 지난 사진·PDF 삭제. `purge_after` 가 지난 접수의 파일을 지우고 `status = 'purged'` 로 표시한다.
  접수 기록 자체는 남긴다 — 몇 건 받았고 언제 회신했는지는 계속 봐야 하기 때문이다.
  ③ 주인 없는 사진 삭제 (24시간 지난 것만).
  **`CRON_SECRET` 을 `WORKER_SECRET` 과 같은 값으로 넣어야 자동으로 돈다.**
- **주인 없는 사진이 저장소를 갉아먹는다.** 사진은 ②단계에서 곧바로 저장소로 올라가지만
  접수 기록은 ④단계를 끝내야 생긴다. 중간에 창을 닫으면 사진만 남고 접수는 없다.
  보관 기간 정리는 접수 기록을 따라가므로 이 파일들을 영영 못 잡는다. 무료 용량이 1GB 라
  쌓이는 만큼 받을 수 있는 학생이 줄어든다. 그래서 크론이 매일 따로 훑는다.
  지금 무엇이 얼마나 쌓였는지는 `GET /api/worker/storage`.
  손으로 치우려면 `POST /api/worker/storage?mode=orphans` (24시간 지난 것),
  `&hours=0` 이면 방금 올라온 것까지 — **접수를 열기 전에만 쓴다.**
  `&dry=1` 은 지우지 않고 개수만 센다.
- **접수 1건 통째로 지우기**: `POST /api/worker/purge?receipt=F0902-013&mode=delete`.
  사진·PDF·DB 기록·Notion 페이지까지 지운다. 되돌릴 수 없다.
- **버킷 통째로 비우기**: `POST /api/worker/storage?mode=wipe&confirm=WIPE-ALL`.
  접수에 걸려 있는 사진까지 전부 지운다. 실수로 부를 수 없게 확인 문구를 받는다.
- **고민 답변은 Notion 페이지 본문에 들어간다.** 속성 칸에 합쳐 넣으면 2000자 제한에 걸리고
  표에서 읽히지도 않는다. 속성 `고민` 은 목록에서 훑을 한 줄 요약(답변 개수 · 어려운 문항 · 원하는 피드백 ·
  첫 답변 앞부분)이고, 문답 전문은 본문에 문항별 제목과 문단으로 들어간다.
- **접수 스위치(OPS-1)** 는 Supabase `app_settings` 를 읽는다. 브라우저에서 세션당 한 번 읽으므로,
  스위치를 바꾼 뒤에는 새로고침해야 반영된다. 제출 API 는 매번 서버에서 다시 확인한다.
- **제출 멱등성**: 클라이언트가 만든 멱등키가 `submissions.idempotency_key` 에 유니크로 들어간다.
  같은 제출을 여러 번 눌러도 접수는 1건이고, 같은 접수번호가 돌아온다.
- **비밀값**: `SUPABASE_SERVICE_ROLE_KEY` 는 서버에서만 쓴다(`src/lib/supabase/admin.ts` 는 `server-only`).
  절대 `NEXT_PUBLIC_` 접두사를 붙이지 말 것 — 붙이면 브라우저로 새어 나가 DB 전체가 열린다.
