import { PHOTO_READ } from '@/config/lms';
import { readSummary, type ReadAnswer } from './ocr-rows';

/**
 * 사진 읽기 한 판의 상태를 화면 말로 바꾸는 부분. 순수 계산이라 브라우저 부품과 시험이
 * 같이 부른다. DB 를 읽고 쓰는 쪽은 photo-read.ts 에 있다.
 */

export type PhotoReadStatus = 'pending' | 'running' | 'done' | 'failed';

/** lms_photo_reads 한 줄 (0016) */
export type PhotoReadRow = {
  attempt_id: string;
  request_no: number;
  status: PhotoReadStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  photo_ids: string[];
  answers: ReadAnswer[];
  unreadable: string[];
  note: string | null;
  error: string | null;
  runs: number;
  updated_at: string;
};

export type ReadView =
  /** 한 번도 부른 적 없다 */
  | { kind: 'none' }
  /** 기다리는 중이거나 읽는 중 */
  | { kind: 'reading'; since: string }
  /** 너무 오래 '읽는 중' — 서버가 중간에 끊긴 것으로 본다 */
  | { kind: 'stuck'; since: string }
  | { kind: 'failed'; error: string; at: string | null }
  | {
      kind: 'done';
      at: string | null;
      /** 읽은 뒤에 사진이 바뀌었다 */
      stale: boolean;
      answers: ReadAnswer[];
      unreadable: string[];
      note: string | null;
      photos: number;
      sure: number;
      check: number[];
      blanks: number[];
    };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * 지금 사진 목록과 함께 보고 상태를 정한다. now 는 시험에서 시계를 고정하려고 받는다 —
 * 화면은 넘기지 않는다 (그리는 중에 시계를 읽으면 React 가 그리기를 순수하지 않다고 본다).
 */
export function readViewOf(
  read: PhotoReadRow | null,
  currentPhotoIds: readonly string[],
  now: number = Date.now(),
): ReadView {
  if (!read || read.request_no <= 0) return { kind: 'none' };
  // 사진이 없으면 읽을 것도 없다. 사진으로 매긴 채점은 마지막 사진을 지울 때 DB 가 비웠다.
  if (currentPhotoIds.length === 0) return { kind: 'none' };

  if (read.status === 'pending' || read.status === 'running') {
    const since = (read.status === 'running' ? read.started_at : null) ?? read.requested_at;
    return now - Date.parse(read.updated_at) > PHOTO_READ.stuckMs ? { kind: 'stuck', since } : { kind: 'reading', since };
  }

  if (read.status === 'failed') return { kind: 'failed', error: read.error ?? 'UNKNOWN', at: read.finished_at };

  const answers = Array.isArray(read.answers) ? read.answers : [];
  // 지금 없는 사진은 짚어도 소용이 없다
  const current = new Set(currentPhotoIds);
  return {
    kind: 'done',
    at: read.finished_at,
    stale: !sameSet(read.photo_ids, currentPhotoIds),
    answers,
    unreadable: read.unreadable.filter((id) => current.has(id)),
    note: read.note,
    photos: read.photo_ids.length,
    ...readSummary(answers),
  };
}

/** 다시 읽어야 하는 상태인가 — 학생이 제출할 때, 매일 새벽 정리가 본다. */
export function needsRead(view: ReadView, photoCount: number): boolean {
  if (photoCount === 0) return false;
  if (view.kind === 'reading') return false;
  if (view.kind === 'done') return view.stale;
  return true;
}

/**
 * 튜터가 직접 매긴 채점과 사진에서 읽은 답이 어디서 다른가.
 * 확실히 읽힌 문항만 견준다 — 애매한 문항은 원래 튜터가 정한다.
 */
export function readDiffers(
  answers: ReadAnswer[],
  saved: { no: number; chosen: number | null; correct: boolean }[],
): number[] {
  const byNo = new Map(saved.map((s) => [s.no, s]));
  return answers
    .filter((a) => a.sure)
    .filter((a) => {
      const s = byNo.get(a.no);
      if (!s) return true;
      // 튜터가 학생 답 없이 O/X 만 찍었으면 견줄 수 있는 것은 빈칸뿐이다
      if (a.answer === null) return s.chosen !== null || s.correct;
      return s.chosen !== null && s.chosen !== a.answer;
    })
    .map((a) => a.no);
}

/* ─────────────────────────────────────────────── 화면이 끝나기를 기다리는 법 */

/**
 * 화면(useReadWatch)이 읽기 상태를 묻는 간격과 그만 묻는 때.
 *
 * 그만 묻는 때는 서버가 '멈춤' 으로 판정하는 때(stuckMs)보다 뒤여야 한다. 먼저 그만두면 읽기가
 * 서버에서 끊겼을 때 화면이 '읽는 중' 에 멈춰 '다시 읽기' 버튼이 끝내 안 나온다.
 * 읽기는 기다리기 시작한 뒤 늦어도 quietMs(30초) 안에 시작하고, 서버는 그 시각부터 stuckMs 를
 * 잰다. 그래서 stuckMs 에 3분을 더해 지켜보면 그때 서버는 끝났거나 멈춤이라고 답한다.
 * 그사이 학생이 사진을 또 바꿔 읽기가 새로 불렸다면 새로 그린 화면이 새 번호로 다시 기다린다.
 */
export const WATCH = {
  everyMs: 4_000,
  /** 오래 걸리면 덜 자주 묻는다 */
  slowEveryMs: 15_000,
  slowAfterMs: 90_000,
  giveUpMs: PHOTO_READ.stuckMs + 3 * 60_000,
} as const;

/**
 * 한 번 물어본 뒤 할 일.
 *   wait     조금 뒤에 다시 묻는다
 *   refresh  화면을 새로 그린다 — 끝났거나, 멈췄거나, 기다릴 만큼 기다렸다
 * kind 는 상태 주소가 준 값이다. 못 물었으면 undefined.
 */
export function watchStep(kind: string | undefined, elapsedMs: number): 'wait' | 'refresh' {
  if (kind !== undefined && kind !== 'reading') return 'refresh';
  if (elapsedMs >= WATCH.giveUpMs) return 'refresh';
  return 'wait';
}

/** 다음에 물을 때까지의 간격 */
export function watchDelay(elapsedMs: number): number {
  return elapsedMs < WATCH.slowAfterMs ? WATCH.everyMs : WATCH.slowEveryMs;
}
