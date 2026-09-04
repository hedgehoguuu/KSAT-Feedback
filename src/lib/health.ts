import 'server-only';
import { RAW_BUCKET, supabaseAdmin } from './supabase/admin';
import { mailConfigured } from './worker/mail';
import { notionConfigured } from './worker/notion';

export type Check = { ok: boolean; detail: string };

export type Health = {
  /** 지금 돌고 있는 배포의 커밋. 고친 게 반영됐는지 확인할 때 쓴다. */
  commit: string | null;
  mode: 'mock' | 'supabase';
  ready: boolean;
  submissionCount: number | null;
  pendingCount: number | null;
  failureCount: number | null;
  checks: Record<string, Check>;
};

/**
 * 설치 점검. /setup 화면과 /api/health 가 함께 쓴다.
 * 키·URL 같은 비밀값은 절대 내보내지 않는다 — 준비됐는지 여부와 안내 문구만 담는다.
 */
export async function getHealth(): Promise<Health> {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const hasUrl = Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const checks: Record<string, Check> = {
    env: {
      ok: hasUrl && hasKey,
      detail:
        hasUrl && hasKey
          ? '환경변수가 들어와 있어요'
          : !hasUrl && !hasKey
            ? 'SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 둘 다 없어요 (지금은 mock 모드예요)'
            : !hasUrl
              ? 'SUPABASE_URL 이 없어요'
              : 'SUPABASE_SERVICE_ROLE_KEY 가 없어요',
    },
    connection: { ok: false, detail: '아직 확인 못 했어요' },
    tables: { ok: false, detail: '아직 확인 못 했어요' },
    functions: { ok: false, detail: '아직 확인 못 했어요' },
    settings: { ok: false, detail: '아직 확인 못 했어요' },
    dailyCap: { ok: false, detail: '아직 확인 못 했어요' },
    rawScore: { ok: false, detail: '아직 확인 못 했어요' },
    bucket: { ok: false, detail: '아직 확인 못 했어요' },
    workerSchema: { ok: false, detail: '아직 확인 못 했어요' },
    classSchema: { ok: false, detail: '아직 확인 못 했어요' },
    proofBucket: { ok: false, detail: '아직 확인 못 했어요' },
    notion: {
      ok: notionConfigured(),
      detail: notionConfigured()
        ? 'NOTION_TOKEN 과 NOTION_DATABASE_ID 가 들어와 있어요'
        : 'NOTION_TOKEN / NOTION_DATABASE_ID 가 없어요. 접수가 Notion 에 안 올라가요',
    },
    mail: {
      ok: mailConfigured(),
      detail: mailConfigured()
        ? `${process.env.GMAIL_USER} 로 접수 확인 메일이 나가요`
        : 'GMAIL_USER / GMAIL_APP_PASSWORD 가 없어요. 접수 확인 메일이 안 나가요',
    },
    workerSecret: {
      ok: Boolean(process.env.WORKER_SECRET),
      detail: process.env.WORKER_SECRET
        ? '재처리 주소가 잠겨 있어요'
        : 'WORKER_SECRET 이 없어요. 재처리 주소를 아무나 부를 수 있어요',
    },
    adminPassword: {
      ok: Boolean(process.env.ADMIN_PASSWORD),
      detail: process.env.ADMIN_PASSWORD
        ? '/admin 과 이 화면이 잠겨 있어요'
        : 'ADMIN_PASSWORD 가 없어요. /admin 이 열리지 않고, 이 화면은 아무나 볼 수 있어요',
    },
    cronSecret: {
      ok: Boolean(process.env.CRON_SECRET),
      detail: process.env.CRON_SECRET
        ? '매일 새벽 3시 자동 정리가 돌아요'
        : 'CRON_SECRET 이 없어요. 자동 정리(밀린 접수 되살리기 · 보관 기간 지난 사진 삭제)가 안 돕니다',
    },
  };

  const db = supabaseAdmin();
  if (!db) {
    for (const key of ['connection', 'tables', 'functions', 'settings', 'dailyCap', 'rawScore', 'bucket', 'workerSchema', 'classSchema', 'proofBucket']) {
      checks[key] = { ok: false, detail: 'Supabase 연결 전이라 확인할 수 없어요' };
    }
    return {
      commit, mode: 'mock', ready: false, submissionCount: null,
      pendingCount: null, failureCount: null, checks,
    };
  }

  const { data, error } = await db.rpc('setup_status');

  if (error) {
    const sqlNotRun = /setup_status|schema cache|does not exist/i.test(error.message);
    checks.connection = sqlNotRun
      ? { ok: true, detail: 'Supabase 에는 닿았어요' }
      : { ok: false, detail: `Supabase 에 못 닿았어요: ${error.message}` };
    const detail = sqlNotRun
      ? 'SQL 을 아직 실행하지 않았어요. supabase/migrations/0001_init.sql 을 SQL Editor 에서 실행해주세요'
      : '확인하지 못했어요';
    for (const key of ['tables', 'functions', 'settings', 'dailyCap', 'rawScore', 'bucket', 'workerSchema', 'classSchema', 'proofBucket']) {
      checks[key] = { ok: false, detail };
    }
    return {
      commit, mode: 'supabase', ready: false, submissionCount: null,
      pendingCount: null, failureCount: null, checks,
    };
  }

  const status = (data ?? {}) as {
    tables?: boolean;
    settings_row?: boolean;
    functions?: boolean;
    worker_schema?: boolean;
    class_schema?: boolean;
    proof_bucket?: boolean;
    bucket?: boolean;
    open_class_count?: number;
    application_count?: number;
    submission_count?: number;
    pending_count?: number;
    failure_count?: number;
    daily_capacity?: number | null;
    today_count?: number;
    raw_score?: boolean;
  };

  checks.connection = { ok: true, detail: 'Supabase 에 정상적으로 닿았어요' };
  checks.tables = {
    ok: Boolean(status.tables),
    detail: status.tables ? '접수 테이블 3개가 있어요' : '테이블이 없어요. SQL 을 실행해주세요',
  };
  checks.functions = {
    ok: Boolean(status.functions),
    detail: status.functions ? '접수번호·제출 함수가 있어요' : '함수가 없어요. SQL 을 다시 실행해주세요',
  };
  checks.settings = {
    ok: Boolean(status.settings_row),
    detail: status.settings_row ? '접수 스위치 행이 있어요' : 'app_settings 에 id=1 행이 없어요',
  };
  // 하루 상한은 0003_daily_cap.sql 을 돌려야 생긴다. 안 돌렸으면 여기서 티가 난다.
  checks.dailyCap = {
    ok: typeof status.daily_capacity === 'number' && status.daily_capacity > 0,
    detail:
      typeof status.daily_capacity === 'number' && status.daily_capacity > 0
        ? `하루 ${status.daily_capacity}건까지 받아요 (오늘 ${status.today_count ?? 0}건)`
        : '하루 상한이 없어요. 0003_daily_cap.sql 을 실행해주세요',
  };
  checks.rawScore = {
    ok: Boolean(status.raw_score),
    detail: status.raw_score
      ? '과목 원점수 칸이 있어요'
      : '원점수 칸이 없어요. 0004_raw_score.sql 을 실행해주세요',
  };
  checks.workerSchema = {
    ok: Boolean(status.worker_schema),
    detail: status.worker_schema
      ? '실패 로그 표와 재처리 함수가 있어요'
      : '0002_worker.sql 을 아직 실행하지 않았어요',
  };
  checks.classSchema = {
    ok: Boolean(status.class_schema),
    detail: status.class_schema
      ? `개설 클래스 ${status.open_class_count ?? 0}개 · 신청 ${status.application_count ?? 0}건`
      : '0005_classes.sql 을 아직 실행하지 않았어요. /class 가 빈 화면이에요',
  };
  checks.proofBucket = {
    ok: Boolean(status.proof_bucket),
    detail: status.proof_bucket
      ? '비공개 버킷 tutor-proof 가 있어요'
      : '버킷 tutor-proof 가 없거나 공개 상태예요. 0005_classes.sql 을 실행해주세요',
  };
  checks.bucket = {
    ok: Boolean(status.bucket),
    detail: status.bucket
      ? `비공개 버킷 ${RAW_BUCKET} 이 있어요`
      : `버킷 ${RAW_BUCKET} 이 없거나 공개 상태예요`,
  };

  return {
    commit,
    mode: 'supabase',
    ready: Object.values(checks).every((c) => c.ok),
    submissionCount: status.submission_count ?? null,
    pendingCount: status.pending_count ?? null,
    failureCount: status.failure_count ?? null,
    checks,
  };
}
