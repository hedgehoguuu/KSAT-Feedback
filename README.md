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

## 지금까지 된 것 (8/28 기준)

| 항목 | 상태 |
|---|---|
| FE-1 4단계 진행 표시 · 되돌아가기 · 상태 일관성 | 됨 |
| FE-2 시험 선택 ① (선택 즉시 다음, 상단 요약 유지) | 됨 |
| FE-3 과목 칩 + 과목별 업로드 섹션 ② (12장/40장 상한, 삭제·순서 변경) | 됨 |
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
| P1-4 퍼널 계측 (Vercel Web Analytics) | 붙임 — 대시보드에서 켜야 집계 시작 |
| P1 (접수 확인 메일, 품질 힌트, 퍼널 계측, 스팸 방지) | **없음** |

## 구조

```
src/config/     시험·과목·문항·운영 상수. 코드에 '국어'·'수학'을 하드코딩하지 않는다 (PRD §6 P2)
  exams.ts            시험 3종 → 학년·과목이 여기서 결정된다
  subjects.ts         과목 코드 ↔ 라벨
  questions.config.ts ③단계 5문항. 문구·개수·타입을 코드 수정 없이 바꾼다
  app.ts              장수 상한, 보관 기간, 회신 SLA, 접수 스위치, 기능 플래그
  steps.ts            4단계 정의
src/lib/        store(zustand+persist) · image(리사이즈) · upload · submit · email · flow
                intake/health(서버 전용) · blobs · draft
src/lib/worker/ process(접수 1건 처리) · pdf(병합) · notion(등록) · mail(확인 메일) — 전부 서버 전용
src/components/ ProgressSteps · ExamSummary · SubjectChips · UploadSection · AutoTextarea · BottomBar
src/app/        / (랜딩) · /apply/{exam,upload,concerns/[subject],email} · /done/[receiptNo]
                /setup (설치 점검, noindex)
                /api/{upload-url,submit,intake,health} · /api/worker/process (재처리)
supabase/migrations/0001_init.sql   스키마·RLS·버킷·제출 함수
supabase/migrations/0002_worker.sql 워커용 컬럼·실패 로그·claim 함수
```

## 운영자용 화면

- `/setup` — 무엇이 준비됐고 무엇이 빠졌는지 ✓/✗ 로 보여준다. 배포 후 여기부터 열어볼 것.
- Supabase Table Editor > `app_settings` 한 줄 — 접수 on/off, 상한, 과목별 off, 마감 문구. **배포 없이 즉시 반영**된다.

## 정해진 값 / 남은 미결

§9 결정 사항은 `src/config/app.ts` 한곳에 모여 있다. 38차 회의에서 아래대로 확정됐다.

| PRD | 결정 | 어디에 |
|---|---|---|
| Q1 | 고1·2 과목 5개 모두 연다 | `subjects.ts` (닫을 땐 `app_settings.disabled_subjects`) |
| Q3 | 접수 상한 없음 | `app_settings.capacity` 에 숫자를 넣으면 즉시 걸린다 |
| Q4 | 사진 보관 30일 | `POLICY.retentionDays` — 동의 문구에 자동 반영 |
| Q5 | 회신 SLA 7일 | `POLICY.replySlaDays` — 완료 화면 날짜에 자동 반영 |
| Q6 | 커스텀 도메인 없이 vercel.app 기본 주소 | `BRANDING.serviceName` 은 페이지 제목에만 쓰임 |
| Q7 | 완료 화면 과외 버튼 끔 | `FEATURES.conversionCta` |

**남은 미결 — Q2 (고민 5문항 최종 문구, 서현, 8/30까지).** 그때까지는 `questions.config.ts` 의 잠정안이 나간다.
문구·개수·타입만 바꾸는 일이라 코드 수정은 필요 없다.

운영 쪽 미결: Q8(접수 확인 메일 발송 주체·발신 주소), Q9(Notion DB 를 팀 워크스페이스에 둘지 분리할지).

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
- **접수 스위치(OPS-1)** 는 Supabase `app_settings` 를 읽는다. 브라우저에서 세션당 한 번 읽으므로,
  스위치를 바꾼 뒤에는 새로고침해야 반영된다. 제출 API 는 매번 서버에서 다시 확인한다.
- **제출 멱등성**: 클라이언트가 만든 멱등키가 `submissions.idempotency_key` 에 유니크로 들어간다.
  같은 제출을 여러 번 눌러도 접수는 1건이고, 같은 접수번호가 돌아온다.
- **비밀값**: `SUPABASE_SERVICE_ROLE_KEY` 는 서버에서만 쓴다(`src/lib/supabase/admin.ts` 는 `server-only`).
  절대 `NEXT_PUBLIC_` 접두사를 붙이지 말 것 — 붙이면 브라우저로 새어 나가 DB 전체가 열린다.
