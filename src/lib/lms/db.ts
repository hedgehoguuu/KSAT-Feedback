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
 * `.in()` 에 넣을 id 가 많을 때 나눠서 묻고, 나눈 묶음마다 끝까지 넘겨 읽는다.
 *
 * PostgREST 는 조건을 주소줄에 싣는다. id 하나가 39자쯤(UUID + 따옴표 + 쉼표)이라
 * 400개면 주소가 15KB 가 되는데, 그 앞의 프록시들이 대개 8~16KB 에서 414 를 낸다.
 * 학생 스무 명이 회차 스무 번을 보면 바로 그 규모다 — 한 학기면 닿는다.
 *
 * 나눠 묻는 것만으로는 모자랐다. Supabase 는 한 번에 1,000줄까지만 주고 나머지는 말없이
 * 자른다. 응시 23개 × 답안 45개면 1,035줄인데 1,000줄만 와서, 채점이 끝난 응시가
 * '덜 매김' 으로 계산됐다. 그래서 묶음마다 range() 로 빈 쪽이 나올 때까지 넘긴다 —
 * '1,000줄보다 덜 왔으니 끝' 으로 치지 않는 것은 서버 상한이 1,000이 아닐 수도 있어서다.
 *
 * run 은 부를 때마다 새 조회를 만들어야 하고, **겹치지 않는 열로 정렬**해야 한다.
 * 정렬이 없으면 쪽을 넘기는 사이 줄 순서가 달라져 같은 줄이 두 번 오거나 빠진다.
 */
const CHUNK = 100;
const PAGE = 1000;

type Pageable<T> = { range(from: number, to: number): PromiseLike<Result<T[] | null>> };

export async function inChunks<T>(
  ids: readonly string[],
  run: (batch: string[]) => Pageable<T>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    for (let from = 0; ; ) {
      const page = await rows(run(batch).range(from, from + PAGE - 1));
      if (page.length === 0) break;
      out.push(...page);
      from += page.length;
    }
  }
  return out;
}
