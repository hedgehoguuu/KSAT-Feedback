import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const RAW_BUCKET = 'exam-papers';

let cached: SupabaseClient | null | undefined;

/**
 * service_role 클라이언트. 워커·서명 URL 발급 전용이며 브라우저로 나가면 안 된다.
 * 환경변수가 없으면 null 을 돌려주고, 호출부는 mock 경로로 떨어진다.
 */
export function supabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}
