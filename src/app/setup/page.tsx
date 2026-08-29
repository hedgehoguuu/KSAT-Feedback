import Link from 'next/link';
import { getHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

const GUIDE: { key: string; label: string; how: string }[] = [
  {
    key: 'env',
    label: '환경변수',
    how: 'Vercel > Settings > Environment Variables 에 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 넣고 다시 배포하기',
  },
  { key: 'connection', label: 'DB 연결', how: 'URL 과 키가 같은 Supabase 프로젝트의 값인지 확인하기' },
  { key: 'tables', label: '테이블', how: 'Supabase > SQL Editor 에서 0001_init.sql 전체를 붙여넣고 Run' },
  { key: 'functions', label: '접수번호·제출 함수', how: '같은 SQL 을 다시 실행하면 만들어져요' },
  { key: 'settings', label: '접수 스위치', how: 'Table Editor > app_settings 에 id=1 행이 있어야 해요' },
  {
    key: 'dailyCap',
    label: '하루 접수 상한',
    how: 'Supabase > SQL Editor 에서 0003_daily_cap.sql 전체를 붙여넣고 Run',
  },
  { key: 'bucket', label: '시험지 저장소', how: 'Storage 에 exam-papers 버킷이 비공개로 있어야 해요' },
  { key: 'workerSchema', label: '워커 표·함수', how: 'Supabase > SQL Editor 에서 0002_worker.sql 전체를 붙여넣고 Run' },
  { key: 'notion', label: 'Notion 자동 등록', how: 'Vercel 환경변수에 NOTION_TOKEN 과 NOTION_DATABASE_ID 넣기' },
  { key: 'mail', label: '접수 확인 메일', how: 'Vercel 환경변수에 GMAIL_USER 와 GMAIL_APP_PASSWORD 넣기 (구글 앱 비밀번호)' },
  { key: 'workerSecret', label: '재처리 주소 잠금', how: 'Vercel 환경변수에 WORKER_SECRET 을 아무 긴 문자열로 넣기' },
  { key: 'cronSecret', label: '매일 자동 정리', how: 'Vercel 환경변수에 CRON_SECRET 을 WORKER_SECRET 과 같은 값으로 넣고 다시 배포' },
];

export default async function SetupPage() {
  const health = await getHealth();

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 pb-12 pt-10">
      <header>
        <h1 className="text-[24px] font-bold leading-[1.35]">설치 점검</h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          접수를 받을 준비가 됐는지 확인하는 화면이에요. 학생에게 보여주는 화면은 아니에요.
        </p>
      </header>

      <div className={['rounded-2xl p-4', health.ready ? 'bg-brand/5' : 'bg-surface'].join(' ')}>
        <p className="text-[17px] font-bold">
          {health.ready ? '접수 받을 준비가 됐어요' : '아직 준비가 안 됐어요'}
        </p>
        <p className="mt-1 text-[13px] leading-[1.6] text-muted">
          {health.mode === 'mock'
            ? '지금은 mock 모드예요. 사진이 실제로 저장되지 않고, 접수도 남지 않아요.'
            : health.ready
              ? `지금까지 들어온 접수 ${health.submissionCount ?? 0}건.`
              : '아래에서 ✗ 표시된 것만 해결하면 돼요.'}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {GUIDE.map(({ key, label, how }) => {
          const check = health.checks[key];
          if (!check) return null;
          return (
            <li key={key} className="rounded-xl border border-line p-4">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <span className={check.ok ? 'text-success' : 'text-danger'}>{check.ok ? '✓' : '✗'}</span>
                {label}
              </p>
              <p className="mt-1 text-[13px] leading-[1.6] text-muted">{check.detail}</p>
              {!check.ok ? (
                <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[13px] leading-[1.6]">할 일 — {how}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Link
        href="/setup"
        prefetch={false}
        className="flex min-h-13 items-center justify-center rounded-2xl bg-surface text-[15px] font-bold active:bg-line"
      >
        다시 확인하기
      </Link>
    </main>
  );
}
