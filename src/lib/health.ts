import 'server-only';
import { RAW_BUCKET, supabaseAdmin } from './supabase/admin';

export type Check = { ok: boolean; detail: string };

export type Health = {
  mode: 'mock' | 'supabase';
  ready: boolean;
  submissionCount: number | null;
  checks: Record<string, Check>;
};

/**
 * 설치 점검. /setup 화면과 /api/health 가 함께 쓴다.
 * 키·URL 같은 비밀값은 절대 내보내지 않는다 — 준비됐는지 여부와 안내 문구만 담는다.
 */
export async function getHealth(): Promise<Health> {
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
    bucket: { ok: false, detail: '아직 확인 못 했어요' },
  };

  const db = supabaseAdmin();
  if (!db) {
    for (const key of ['connection', 'tables', 'functions', 'settings', 'bucket']) {
      checks[key] = { ok: false, detail: 'Supabase 연결 전이라 확인할 수 없어요' };
    }
    return { mode: 'mock', ready: false, submissionCount: null, checks };
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
    for (const key of ['tables', 'functions', 'settings', 'bucket']) {
      checks[key] = { ok: false, detail };
    }
    return { mode: 'supabase', ready: false, submissionCount: null, checks };
  }

  const status = (data ?? {}) as {
    tables?: boolean;
    settings_row?: boolean;
    functions?: boolean;
    bucket?: boolean;
    submission_count?: number;
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
  checks.bucket = {
    ok: Boolean(status.bucket),
    detail: status.bucket
      ? `비공개 버킷 ${RAW_BUCKET} 이 있어요`
      : `버킷 ${RAW_BUCKET} 이 없거나 공개 상태예요`,
  };

  return {
    mode: 'supabase',
    ready: Object.values(checks).every((c) => c.ok),
    submissionCount: status.submission_count ?? null,
    checks,
  };
}
