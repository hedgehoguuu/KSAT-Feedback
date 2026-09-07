import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * LMS 의 모든 DB 접근이 지나는 자리.
 *
 * supabase-js 는 실패해도 예외를 던지지 않고 `{ data, error }` 로 돌려준다.
 * 그래서 확인하지 않으면 두 가지가 조용히 일어난다.
 *
 *   쓰기 — 저장이 안 됐는데 화면이 '저장했어요' 라고 말한다.
 *   읽기 — 못 읽었는데 **빈 목록**으로 둔갑한다. 이쪽이 더 위험하다:
 *          채점 화면이 답안을 못 읽으면 아무것도 안 매긴 것처럼 보이고,
 *          튜터가 다시 매겨 저장하면 진짜 채점이 그 위에 덮인다.
 *
 * 그래서 여기를 지나는 모든 것이 실패하면 던진다. 화면은 오류를 보여주고 사람은 다시 누른다.
 * 조용히 틀린 화면보다 시끄러운 오류가 낫다.
 */

export function db() {
  const client = supabaseAdmin();
  if (!client) throw new Error('LMS_DB_MISSING');
  return client;
}

type Result<T> = { data: T; error: unknown };

/** 쓰기. 실패하면 던진다. */
export async function must<T>(op: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await op;
  if (error) throw error;
  return data;
}

/** 여러 줄 읽기. 실패하면 던지고, 없으면 빈 배열. */
export async function rows<T>(op: PromiseLike<Result<T[] | null>>): Promise<T[]> {
  const { data, error } = await op;
  if (error) throw error;
  return data ?? [];
}

/** 한 줄 읽기. 실패하면 던지고, 없으면 null. */
export async function one<T>(op: PromiseLike<Result<T | null>>): Promise<T | null> {
  const { data, error } = await op;
  if (error) throw error;
  return data;
}

/**
 * `.in()` 에 넣을 id 가 많을 때 나눠서 묻는다.
 *
 * PostgREST 는 조건을 주소줄에 싣는다. id 하나가 39자쯤(UUID + 따옴표 + 쉼표)이라
 * 400개면 주소가 15KB 가 되는데, 그 앞의 프록시들이 대개 8~16KB 에서 414 를 낸다.
 * 학생 스무 명이 회차 스무 번을 보면 바로 그 규모다 — 한 학기면 닿는다.
 *
 * 그때 터지지 않고 조용히 반쯤만 읽히는 것도 아니어야 해서, 나눠 묻고 이어 붙인다.
 */
const CHUNK = 100;

export async function inChunks<T>(
  ids: readonly string[],
  run: (batch: string[]) => PromiseLike<Result<T[] | null>>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...(await rows(run(ids.slice(i, i + CHUNK)))));
  }
  return out;
}
