import 'server-only';
import { after } from 'next/server';
import { PHOTO_READ, PHOTO_READ_RETRYABLE } from '@/config/lms';
import { db, inChunks, one, rows } from './db';
import { getFile } from './files';
import { ocrConfigured, readStudentAnswers, type OcrImage, type ReadTiming, type StudentReadResult } from './ocr';
import { needsRead, readViewOf, type PhotoReadRow } from './photo-read-state';
import { listPhotos, type PhotoRow } from './photos';

/**
 * 학생 시험지 사진으로 자동 채점 (0016).
 *
 *   학생이 사진을 올리거나 지운다
 *     → 읽기를 부른다 (request_photo_read — 번호가 하나 오른다)
 *     → 응답을 보낸 뒤 뒤에서 조용히 기다린다 (quietMs). 그 사이 사진이 또 오면 번호가 올라서
 *       이 읽기는 시작하지 않는다 — 카메라로 한 장씩 찍어 올리는 동안 매번 읽지 않는다.
 *     → 시작한다 (claim_photo_read) → 사진을 받아 모델에게 보낸다 (ocr.ts)
 *     → 결과를 적고 채점에 옮긴다 (finish_photo_read). 그사이 더 새 읽기가 있으면 버린다.
 *
 * 채점에 옮기는 규칙(확실한 것만 · 튜터 채점과 공개한 점수는 안 덮음)은 DB 함수에 있다.
 * 여기서 두 번 적으면 언젠가 어긋난다.
 *
 * 뒤에서 도는 일은 서버 함수의 시간 상한 안에서만 돈다. 끊기면 '읽는 중' 에 멈춰 남는데,
 * 튜터 화면이 그것을 '멈춤' 으로 보여 주고 다시 읽기를 받는다. 매일 새벽 정리도 한 번 더 읽는다.
 */

export type { PhotoReadRow } from './photo-read-state';

const READ_COLS =
  'attempt_id, request_no, status, requested_at, started_at, finished_at, photo_ids, answers, unreadable, note, error, runs, updated_at';

export function photoReadConfigured(): boolean {
  return ocrConfigured();
}

export async function getPhotoRead(attemptId: string): Promise<PhotoReadRow | null> {
  return await one<PhotoReadRow>(
    db().from('lms_photo_reads').select(READ_COLS).eq('attempt_id', attemptId).maybeSingle(),
  );
}

export async function photoReadsOf(attemptIds: string[]): Promise<Map<string, PhotoReadRow>> {
  const found = await inChunks<PhotoReadRow>(attemptIds, (b) =>
    db().from('lms_photo_reads').select(READ_COLS).in('attempt_id', b).order('attempt_id'));
  return new Map(found.map((r) => [r.attempt_id, r]));
}

/* ─────────────────────────────────────────────────────────── 부르기 */

/**
 *   QUEUED  불렀다 (뒤에서 돈다)
 *   CAPPED  학생 쪽 자동 읽기 횟수 상한에 걸려 부르지 않았다. 옛 사진의 채점은 DB 가 이미 비웠다.
 *   EMPTY   사진이 없어 부를 것이 없다. 사진으로 매긴 채점은 마지막 사진을 지울 때 DB 가 비웠다.
 *   OFF     ANTHROPIC_API_KEY 가 없다
 */
export type ReadRequest = 'QUEUED' | 'CAPPED' | 'EMPTY' | 'OFF';

/**
 * 읽기 번호를 하나 올린다. 학생 쪽에서 부를 때는 모델을 부른 횟수에 상한을 둔다.
 * 0 이면 상한에 걸려 올리지 않은 것이다.
 */
async function queue(attemptId: string, maxRuns: number | null): Promise<number> {
  const { data, error } = await db().rpc('request_photo_read', {
    payload: { attempt_id: attemptId, max_runs: maxRuns },
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** 뒤에서 도는 일을 맡기는 자리. 시험은 after() 대신 자기 것을 넣는다. */
export type Schedule = (task: () => Promise<unknown>) => void;

/**
 * 읽기를 부르고, 응답을 보낸 뒤 뒤에서 돌린다.
 *
 *   by 'student'  학생이 사진을 바꿨다. 조용해질 때까지 기다리고, 횟수에 상한이 있다.
 *   by 'tutor'    튜터가 '다시 읽기' 를 눌렀다. 바로 읽고, 상한이 없다.
 */
export async function requestPhotoRead(
  attemptId: string,
  opts: { by: 'student' | 'tutor'; delayMs?: number; schedule?: Schedule },
): Promise<ReadRequest> {
  if (!ocrConfigured()) return 'OFF';
  if ((await listPhotos(attemptId)).length === 0) return 'EMPTY';
  const requestNo = await queue(attemptId, opts.by === 'student' ? PHOTO_READ.maxStudentRuns : null);
  if (requestNo <= 0) return 'CAPPED';

  const delayMs = opts.delayMs ?? (opts.by === 'student' ? PHOTO_READ.quietMs : 0);
  const schedule = opts.schedule ?? after;
  schedule(() => runPhotoRead(attemptId, requestNo, { delayMs }));
  return 'QUEUED';
}

/**
 * 학생이 제출할 때 부른다. 사진을 바꾼 뒤의 읽기가 이미 돌았거나 도는 중이면 아무것도 안 한다.
 * 사진을 올릴 때 부른 읽기가 상한에 걸렸거나 끊겼을 때를 위한 것이다.
 */
export async function ensurePhotoRead(attemptId: string, schedule?: Schedule): Promise<ReadRequest | 'FRESH'> {
  const [read, photos] = await Promise.all([getPhotoRead(attemptId), listPhotos(attemptId)]);
  const view = readViewOf(read, photos.map((p) => p.id));
  if (!needsRead(view, photos.length)) return 'FRESH';
  return requestPhotoRead(attemptId, { by: 'student', delayMs: PHOTO_READ.submitQuietMs, schedule });
}

/**
 * 읽은 답을 채점에 옮긴다. force 면 튜터가 매긴 채점도 덮는다 — 튜터가 직접 누른 것이다.
 * 옮긴 문항 수를 돌려준다. 옮기지 못했으면(공개한 점수 · 읽기 없음) -1.
 */
export async function applyPhotoRead(attemptId: string, force: boolean): Promise<number> {
  const { data, error } = await db().rpc('apply_photo_read', {
    payload: { attempt_id: attemptId, force },
  });
  if (error) throw error;
  return Number(data ?? -1);
}

/* ─────────────────────────────────────────────────────────── 읽기 */

export type RunOutcome = 'DONE' | 'SKIPPED' | 'FAILED';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 마감 시각까지 안 끝나면 null. 사진 받기가 읽기 예산을 다 먹지 않게 한다. */
async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 읽기 한 판. 던지지 않는다 — 뒤에서 도는 일이라 던져도 받을 사람이 없다.
 * 실패는 그 읽기 줄에 적는다.
 *
 * 사진 받기와 모델 요청이 모두 같은 마감 시각(deadline) 안에서 돈다. 시험은 timing 으로
 * 몇 초짜리 예산을 준다.
 */
export async function runPhotoRead(
  attemptId: string,
  requestNo: number,
  opts: { delayMs?: number; deadline?: number; timing?: Omit<ReadTiming, 'deadline'> } = {},
): Promise<RunOutcome> {
  if (opts.delayMs) await sleep(opts.delayMs);
  const deadline = opts.deadline ?? Date.now() + PHOTO_READ.budgetMs;
  const reserveMs = opts.timing?.reserveMs ?? PHOTO_READ.reserveMs;

  try {
    const { data, error } = await db().rpc('claim_photo_read', {
      payload: { attempt_id: attemptId, request_no: requestNo },
    });
    if (error) throw error;
    // 기다리는 사이 새 사진이 와서 번호가 올랐다. 그 번호의 읽기가 대신 돈다.
    if (data !== true) return 'SKIPPED';
  } catch (error) {
    console.error('[lms] 사진 읽기를 시작하지 못했어요', attemptId, error);
    return 'FAILED';
  }

  try {
    const photos = await listPhotos(attemptId);
    let result: StudentReadResult;
    if (photos.length === 0) {
      // 그사이 사진이 모두 지워졌다. 모델은 부르지 않는다. 마지막 사진을 지울 때 DB 가 읽기 번호를
      // 올리고 채점도 비웠으므로, 아래에서 마치려 해도 STALE 로 버려진다.
      result = { ok: true, answers: [], unreadable: [], note: '' };
    } else {
      const images = await beforeDeadline(loadImages(photos), deadline - reserveMs);
      if (images === null) return await fail(attemptId, requestNo, 'TIMEOUT');
      if (images === 'FAILED') return await fail(attemptId, requestNo, 'FILE');
      result = await readStudentAnswers(images, { ...opts.timing, deadline });
    }
    if (!result.ok) return await fail(attemptId, requestNo, result.reason);

    const { data, error } = await db().rpc('finish_photo_read', {
      payload: {
        attempt_id: attemptId,
        request_no: requestNo,
        photo_ids: photos.map((p) => p.id),
        answers: result.answers,
        unreadable: result.unreadable.map((i) => photos[i]?.id).filter((id): id is string => Boolean(id)),
        note: result.note,
      },
    });
    if (error) throw error;
    // STALE: 더 새 읽기가 대신 돈다. CHANGED: 읽는 사이 사진이 바뀌어 DB 가 실패로 적었다.
    if (data === 'STALE') return 'SKIPPED';
    if (data === 'CHANGED') return 'FAILED';
    return 'DONE';
  } catch (error) {
    console.error('[lms] 사진 읽기 실패', attemptId, error);
    return await fail(attemptId, requestNo, 'UNKNOWN');
  }
}

async function loadImages(photos: PhotoRow[]): Promise<OcrImage[] | 'FAILED'> {
  try {
    return await Promise.all(
      photos.map(async (p) => ({
        media_type: 'image/jpeg',
        data: Buffer.from(await getFile(p.storage_path)).toString('base64'),
      })),
    );
  } catch (error) {
    console.error('[lms] 읽을 사진을 못 받았어요', error);
    return 'FAILED';
  }
}

async function fail(attemptId: string, requestNo: number, reason: string): Promise<'FAILED'> {
  const { error } = await db().rpc('fail_photo_read', {
    payload: { attempt_id: attemptId, request_no: requestNo, error: reason },
  });
  if (error) console.error('[lms] 사진 읽기 실패를 못 적었어요', attemptId, reason, error);
  return 'FAILED';
}

/* ─────────────────────────────────────────────────── 매일 새벽 되살리기 */

/**
 * 멈췄거나, 다시 부르면 나아질 이유로 실패한 읽기를 한 번 더 돌린다 (/api/worker/cron).
 *
 *   · 사흘이 지난 것은 건드리지 않는다 — 그때쯤이면 튜터가 이미 손으로 매겼다.
 *   · 이미 많이 부른 것(maxRetryRuns)은 DB 에서 먼저 거른다. 개수 제한(limit)보다 뒤에 거르면
 *     상한에 걸린 오래된 줄들이 자리를 다 차지해, 되살릴 수 있는 줄이 매일 밀려난다.
 *   · 오래된 것부터 하나씩, 마감 시각(deadline) 안에서만 돌린다. 한 판이 1–2분이라 겹쳐 돌리지 않는다.
 */
export async function retryPhotoReads(opts: {
  deadline: number;
  limit: number;
  timing?: Omit<ReadTiming, 'deadline'>;
  /** 한 판에 넉넉히 주는 시간. 남은 시간이 이보다 짧으면 다음 날로 넘긴다. */
  runMs?: number;
}): Promise<{ found: number; done: number; failed: number }> {
  const out = { found: 0, done: 0, failed: 0 };
  if (!ocrConfigured()) return out;

  const now = Date.now();
  const since = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  const stuckBefore = new Date(now - PHOTO_READ.stuckMs).toISOString();

  const [failed, stuck] = await Promise.all([
    rows<PhotoReadRow>(
      db()
        .from('lms_photo_reads')
        .select(READ_COLS)
        .eq('status', 'failed')
        .in('error', [...PHOTO_READ_RETRYABLE])
        .lt('runs', PHOTO_READ.maxRetryRuns)
        .gte('updated_at', since)
        .order('updated_at')
        .limit(opts.limit),
    ),
    rows<PhotoReadRow>(
      db()
        .from('lms_photo_reads')
        .select(READ_COLS)
        .in('status', ['pending', 'running'])
        .lt('runs', PHOTO_READ.maxRetryRuns)
        .lt('updated_at', stuckBefore)
        .gte('updated_at', since)
        .order('updated_at')
        .limit(opts.limit),
    ),
  ]);

  const targets = [...failed, ...stuck]
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, opts.limit);
  out.found = targets.length;

  const runMs = opts.runMs ?? 120_000;
  for (const target of targets) {
    if (opts.deadline - Date.now() < runMs) break;
    try {
      const requestNo = await queue(target.attempt_id, null);
      const outcome = await runPhotoRead(target.attempt_id, requestNo, { deadline: opts.deadline, timing: opts.timing });
      if (outcome === 'DONE') out.done += 1;
      else if (outcome === 'FAILED') out.failed += 1;
    } catch (error) {
      console.error('[lms] 사진 읽기 되살리기 실패', target.attempt_id, error);
      out.failed += 1;
    }
  }
  return out;
}
