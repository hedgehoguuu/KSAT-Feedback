import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { KINDS, PAPER, PHOTO_READ, QUESTION_COUNT, SUBJECT, UNITS, UNIT_GROUPS, paperSummary } from '@/config/lms';
import { mergeStudentReads, normalizeExtracted, type OcrResult, type ReadAnswer, type ReadBatch } from './ocr-rows';
import { callTimeoutMs, canWaitFor, retryWaitMs, shouldRetry, type CallBudget, type RetryInfo } from './retry';

/** 사진을 읽는 모델. 정답표와 학생 시험지가 같이 쓴다. */
const OCR_MODEL = 'claude-opus-5';

/**
 * 정답표를 사진에서 읽어 온다.
 *
 * 수학 시험지는 배점과 번호 구성이 정해져 있어서 회차마다 넣을 것은 정답 30개뿐이다.
 * 그래도 30개를 손으로 옮기다 보면 한 칸씩 밀린다. 시험지 뒤의 정답표나 해설지 첫 장을
 * 찍어 올리면 초안을 만들어 준다.
 *
 * 두 가지를 지킨다.
 *
 *   1) **읽은 것만 말한다.** 안 보이는 정답은 비워서 돌려주고, 화면이 그 번호를 짚어 준다.
 *      단원도 사진에 적혀 있을 때만 받는다 — 번호만 보고 짐작한 단원이 조용히 저장되면
 *      단원별 정답률이 거짓말이 된다.
 *   2) **저장하지 않는다.** 결과는 정답표 칸에 채워 넣기만 하고, 튜터가 눈으로 보고
 *      저장을 눌러야 DB 로 간다. 사진도 서버에 남기지 않는다.
 */

export function ocrConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type OcrImage = { media_type: string; data: string };

// 값 검사와 모양은 ocr-rows.ts 에 있다 — 키 없이 확인할 수 있도록 떼어 뒀다.
export { normalizeExtracted, type OcrResult, type OcrRow } from './ocr-rows';

/**
 * 받을 모양.
 *
 * 정답과 단원은 못 읽었을 수 있으므로 비울 수 있게 둔다. 억지로 하나를 고르게 하면
 * 모델은 반드시 아무거나 고른다 — 그리고 그게 맞는지 아무도 확인하지 않는다.
 *
 * enum 과 범위는 SDK 가 요청을 보내기 전에 설명 문구로 낮춘다(기본 동작). 즉 이 스키마가
 * 보장하는 것은 **키와 자료형까지**이고, 값이 실제로 범위 안에 있는지는 보장하지 않는다.
 * 그래서 값 검사는 normalizeExtracted() 가 다시 한다 — 거기가 진짜 방어선이다.
 */
const EXTRACTED_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: '사진에서 읽은 문항. 번호 순서대로.',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer', minimum: 1, maximum: QUESTION_COUNT, description: '문항 번호' },
          answer: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 999,
            description: '정답. 5지선다는 1–5, 단답형은 0–999. 안 보이면 null',
          },
          unit_code: {
            type: ['string', 'null'],
            enum: [...UNITS.map((u) => u.code), null],
            description: '사진에 단원이 적혀 있을 때만. 아니면 null',
          },
        },
        required: ['no', 'answer', 'unit_code'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: '무엇을 읽었고 무엇이 흐릿했는지 한국어 두 문장 이내' },
  },
  required: ['questions', 'note'],
  additionalProperties: false,
} as const;

function paperGuide(): string {
  const ranges = (kind: keyof typeof KINDS) =>
    PAPER.filter((q) => q.kind === kind)
      .map((q) => q.no)
      .join(', ');
  return [
    `- 번호 구성: ${paperSummary()} (선택과목은 ${SUBJECT.elective})`,
    `- ${KINDS.choice}(답 1–5): ${ranges('choice')}번`,
    `- ${KINDS.short}(답 0–999 정수): ${ranges('short')}번`,
  ].join('\n');
}

function unitGuide(): string {
  return UNITS.map((u) => `- ${u.code}: ${UNIT_GROUPS[u.group]} ${u.label}`).join('\n');
}

const SYSTEM = `너는 한국 수능형 ${SUBJECT.name} 실전 모의고사의 정답표를 읽어 표로 옮기는 일을 한다.

시험지 모양은 정해져 있다:
${paperGuide()}

쓸 수 있는 단원 코드는 이것뿐이다:
${unitGuide()}

지켜야 할 것:
- 사진에 **실제로 보이는 것만** 적는다. 안 보이거나 흐려서 확신이 없으면 null 로 둔다.
- 정답표에 선택과목이 여럿(확률과 통계 · 미적분 · 기하) 함께 있으면 23–30번은 **${SUBJECT.elective} 것만** 적는다.
  다른 선택과목의 23–30번은 적지 않는다.
- 5지선다 정답은 ①–⑤ 로 적혀 있어도 1–5 숫자로 적는다.
- 단원(unit_code)은 사진에 단원 이름이 실제로 적혀 있을 때만 채운다.
  번호나 문제 내용을 보고 짐작하지 마라. 1–22번은 수학Ⅰ·수학Ⅱ, 23–30번은 미적분 단원만 쓸 수 있다.
- 배점은 적지 않는다. 번호로 정해져 있다.
- 문항 번호 순서대로 준다. 사진에 없는 번호는 만들어 내지 않는다.`;

/**
 * 사진 여러 장을 한 번에 읽는다. 정답표가 두 쪽으로 나뉘어 있는 일이 흔해서
 * 장마다 따로 부르면 번호가 겹치거나 끊긴다.
 */
export async function readAnswerKey(images: OcrImage[]): Promise<OcrResult> {
  if (!ocrConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (images.length === 0) return { ok: false, reason: 'NO_IMAGE' };

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.parse({
      model: OCR_MODEL,
      max_tokens: 16000,
      // 표를 정확히 옮기는 일이라 대충 훑으면 번호가 밀린다. 생각을 켜 둔다.
      thinking: { type: 'adaptive' },
      // 모델의 안전 분류기가 드물게 요청을 거절하면, 같은 요청을 알맞은 다른 모델로 한 번 더 돌린다.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.media_type as 'image/jpeg', data: img.data },
            })),
            {
              type: 'text' as const,
              text: `이 회차는 1–${QUESTION_COUNT}번이다. 사진에서 읽을 수 있는 정답을 전부 뽑아줘.`,
            },
          ],
        },
      ],
      output_config: { format: betaJSONSchemaOutputFormat(EXTRACTED_SCHEMA) },
    });

    // 거절되면 본문이 비어 있다. 읽기 전에 먼저 본다.
    if (response.stop_reason === 'refusal') return { ok: false, reason: 'REFUSED' };

    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, reason: 'UNREADABLE' };

    const { rows, unread, conflicts } = normalizeExtracted(parsed.questions);
    if (rows.every((r) => r.answer === null)) return { ok: false, reason: 'UNREADABLE' };

    return { ok: true, rows, unread, conflicts, note: parsed.note?.trim() || '' };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/** 무엇이 잘못됐는지에 따라 화면이 다른 말을 해야 한다. 좁은 것부터 본다. */
function reasonOf(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'BAD_KEY';
  if (error instanceof Anthropic.RateLimitError) return 'RATE_LIMIT';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'TIMEOUT';
  if (error instanceof Anthropic.APIError) return 'API_ERROR';
  return 'UNKNOWN';
}

/* ───────────────────────────────────────────── 학생 시험지에서 학생 답 읽기 */

/**
 * 받을 모양. 사진에 **보이는** 문항만 적게 한다 — 사진을 나눠 보내므로, 안 보인 번호와
 * 보였는데 비어 있는 번호를 구분해야 한다. 앞의 것은 아예 안 적고, 뒤의 것은 null 로 적는다.
 */
const STUDENT_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      description: '이 사진들에 보이는 문항마다 한 줄. 번호 순서대로.',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer', minimum: 1, maximum: QUESTION_COUNT, description: '문항 번호' },
          answer: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 999,
            description: '학생이 고른 · 적은 최종 답. 5지선다는 1–5, 단답형은 0–999. 표시가 없거나 알아볼 수 없으면 null',
          },
          sure: {
            type: 'boolean',
            description: '학생의 최종 답(또는 비워 둔 것)이 분명하면 true. 조금이라도 헷갈리면 false',
          },
          note: {
            type: ['string', 'null'],
            description: 'sure 가 false 일 때 이유 한 줄 (예: "②와 ④ 둘 다 동그라미"). 아니면 null',
          },
        },
        required: ['no', 'answer', 'sure', 'note'],
        additionalProperties: false,
      },
    },
    unreadable_photos: {
      type: 'array',
      items: { type: 'integer' },
      description: '흐리거나 잘리거나 너무 어두워 읽을 수 없는 사진의 번호(이 요청 안에서 1부터)',
    },
    note: { type: 'string', description: '무엇이 보였고 무엇이 어려웠는지 한국어 두 문장 이내' },
  },
  required: ['answers', 'unreadable_photos', 'note'],
  additionalProperties: false,
} as const;

const STUDENT_SYSTEM = `너는 학생이 풀고 난 한국 수능형 ${SUBJECT.name} 실전 모의고사 시험지 사진을 보고, 학생이 문항마다 **고르거나 적은 답**을 옮겨 적는 일을 한다.
채점은 하지 않는다. 정답은 모른다고 생각하고, 문제를 직접 풀어 답을 짐작하지 마라. 학생이 표시한 것만 옮긴다.

시험지 모양은 정해져 있다:
${paperGuide()}

학생의 답을 찾는 곳:
- ${KINDS.choice}: 학생이 동그라미 · 체크 · 밑줄 등으로 표시한 선택지 번호(①–⑤)를 1–5 로 적는다.
  X · 빗금 · 두 줄로 지운 선택지는 고른 것이 아니다. 여러 선택지에 표시가 남아 있으면 최종 선택이 분명할 때만 적는다.
- ${KINDS.short}: 학생이 최종 답으로 적은 정수. 대개 동그라미나 네모로 두르거나 '답' 옆에 적는다.
  풀이 중간에 나온 수는 답이 아니다.
- 답안지(OMR 카드)나 학생이 답을 모아 적은 표가 사진에 있으면 그것을 먼저 본다.
  문제지의 표시와 다르면 sure 를 false 로 두고 note 에 적는다.

지켜야 할 것:
- 이 사진들에 **보이는 문항만** 적는다. 사진에 없는 번호는 적지 않는다.
- 보이는 문항인데 표시가 전혀 없으면 answer 는 null, sure 는 true 다 (학생이 비워 둔 문항).
- 보이는데 알아볼 수 없으면 answer 는 null, sure 는 false 다.
- 조금이라도 헷갈리면 sure 를 false 로 두고 note 에 이유를 짧게 적는다. 사람이 그 문항만 다시 본다.
- 학생 이름 · 학교 같은 개인 정보는 어디에도 적지 않는다.
- 흐리거나 잘려서 읽을 수 없는 사진은 unreadable_photos 에 그 사진 번호를 적는다.`;

export type StudentReadResult =
  | { ok: true; answers: ReadAnswer[]; unreadable: number[]; note: string }
  | { ok: false; reason: string };

type Chunk = { offset: number; images: OcrImage[] };
type ChunkRead = ReadBatch & { note: string };
type Failure = { reason: string };

/** 시간 계산을 바꿔 쓸 수 있게 받는다 — 시험은 몇 초짜리 예산으로 돌린다. */
export type ReadTiming = {
  /** 읽기 전체의 마감 시각(ms). 사진 받기 · 모든 요청 · 재시도 기다림이 여기 안에 든다. */
  deadline?: number;
  minCallMs?: number;
  reserveMs?: number;
  callTimeoutMs?: number;
  maxRetries?: number;
};

type Timing = CallBudget & { deadline: number; maxRetries: number };

/**
 * 학생 시험지 사진에서 학생 답을 읽는다. 사진은 몇 장씩 나눠 보내고, 받은 것을 한 벌로 합친다.
 *
 * 나눠 보내는 까닭은 요청 한 번의 크기다. 긴 변 2000px 사진은 한 장이 입력 4천 토큰쯤이라
 * 스무 장을 한 번에 보내면 낮은 요금 등급의 분당 한도를 혼자 넘는다. 나눠 보내면 같은 문항이
 * 두 사진에 보일 수 있는데(문제지와 답안지), 합칠 때 서로 맞춰 본다 (ocr-rows.ts).
 *
 * 한 요청이라도 실패하면 전체를 실패로 돌려준다. 반쪽 결과로 채점하면 빠진 사진의 문항이
 * '찾지 못함' 으로 남는데, 그게 사진 탓인지 요청 탓인지 화면이 알 수 없다. 그때는 나머지
 * 요청도 바로 끊는다.
 *
 * 마감 시각(deadline)을 넘기지 않는다. 재시도는 여기서 직접 세고(retry.ts), 시각이 되면 보내던
 * 요청도 끊고 TIMEOUT 을 돌려준다 — 서버 함수가 먼저 끊기면 실패조차 적지 못한다.
 */
export async function readStudentAnswers(images: OcrImage[], opts: ReadTiming = {}): Promise<StudentReadResult> {
  if (!ocrConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (images.length === 0) return { ok: false, reason: 'NO_IMAGE' };

  const timing: Timing = {
    deadline: opts.deadline ?? Date.now() + PHOTO_READ.budgetMs,
    minCallMs: opts.minCallMs ?? PHOTO_READ.minCallMs,
    reserveMs: opts.reserveMs ?? PHOTO_READ.reserveMs,
    maxCallMs: opts.callTimeoutMs ?? PHOTO_READ.callTimeoutMs,
    maxRetries: opts.maxRetries ?? PHOTO_READ.maxRetries,
  };

  const client = new Anthropic();
  const chunks: Chunk[] = [];
  for (let i = 0; i < images.length; i += PHOTO_READ.batchSize) {
    chunks.push({ offset: i, images: images.slice(i, i + PHOTO_READ.batchSize) });
  }

  const controller = new AbortController();
  const stopAt = setTimeout(() => controller.abort(), Math.max(0, timing.deadline - timing.reserveMs - Date.now()));
  const results: (ChunkRead | Failure | undefined)[] = new Array(chunks.length);
  let firstFailure: string | null = null;
  let cursor = 0;

  const worker = async () => {
    while (!controller.signal.aborted && cursor < chunks.length) {
      const index = cursor++;
      const result = await readChunk(client, chunks[index], images.length, timing, controller.signal);
      results[index] = result;
      if ('reason' in result && firstFailure === null) {
        firstFailure = result.reason;
        controller.abort();
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(PHOTO_READ.concurrency, chunks.length) }, worker));
  } finally {
    clearTimeout(stopAt);
  }

  if (firstFailure !== null) return { ok: false, reason: firstFailure };
  const reads = results.filter((r): r is ChunkRead => Boolean(r && !('reason' in r)));
  if (reads.length !== chunks.length) return { ok: false, reason: 'TIMEOUT' };

  const { answers, unreadable } = mergeStudentReads(reads);
  const note = reads
    .map((r) => r.note.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
  return { ok: true, answers, unreadable, note };
}

/** 요청 하나. 실패하면 다시 보낼 만한지, 기다려도 마감 안에 들어오는지 보고 다시 보낸다. */
async function readChunk(
  client: Anthropic,
  chunk: Chunk,
  total: number,
  timing: Timing,
  signal: AbortSignal,
): Promise<ChunkRead | Failure> {
  const params = {
    model: OCR_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' as const },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: STUDENT_SYSTEM,
    messages: [
      {
        role: 'user' as const,
        content: [
          ...chunk.images.flatMap((img, k) => [
            { type: 'text' as const, text: `사진 ${k + 1} (시험지 사진 ${total}장 중 ${chunk.offset + k + 1}번째)` },
            {
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.media_type as 'image/jpeg', data: img.data },
            },
          ]),
          {
            type: 'text' as const,
            text: `위 사진 ${chunk.images.length}장에 보이는 문항마다 학생이 고르거나 적은 답을 옮겨줘.`,
          },
        ],
      },
    ],
    // 무엇이 표시돼 있는지 보는 일이라 깊이 생각할수록 나아지지 않는다. 한 단계 낮춰 빠르게 돈다.
    output_config: { effort: 'medium' as const, format: betaJSONSchemaOutputFormat(STUDENT_SCHEMA) },
  };

  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) return { reason: 'TIMEOUT' };
    const timeout = callTimeoutMs(timing.deadline, Date.now(), timing);
    if (timeout === null) return { reason: 'TIMEOUT' };

    try {
      // 재시도는 SDK 에 맡기지 않는다 (retry.ts 머리말).
      const response = await client.beta.messages.parse(params, { timeout, maxRetries: 0, signal });

      if (response.stop_reason === 'refusal') return { reason: 'REFUSED' };
      const parsed = response.parsed_output;
      if (!parsed) return { reason: 'UNREADABLE' };

      return {
        offset: chunk.offset,
        count: chunk.images.length,
        answers: parsed.answers,
        unreadable_photos: parsed.unreadable_photos,
        note: parsed.note ?? '',
      };
    } catch (error) {
      if (signal.aborted) return { reason: 'TIMEOUT' };
      const reason = reasonOf(error);
      const info = retryInfoOf(error);
      const last = !info || !shouldRetry(info) || attempt >= timing.maxRetries;
      const wait = info ? retryWaitMs(info, attempt) : 0;
      if (last || !canWaitFor(timing.deadline, Date.now(), wait, timing)) {
        console.error('[lms] 시험지 사진 읽기 요청 실패', reason, error instanceof Error ? error.message : error);
        return { reason };
      }
      if (!(await pause(wait, signal))) return { reason: 'TIMEOUT' };
    }
  }
}

function retryInfoOf(error: unknown): RetryInfo | null {
  if (error instanceof Anthropic.APIUserAbortError) return null;
  // 연결 끊김과 응답 시간 초과 (시간 초과도 이 갈래의 하위 갈래다)
  if (error instanceof Anthropic.APIConnectionError) return { connection: true };
  if (error instanceof Anthropic.APIError) return { status: error.status, headers: error.headers ?? null };
  return null;
}

/** ms 만큼 쉰다. 그 사이 끊기면 거짓. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
