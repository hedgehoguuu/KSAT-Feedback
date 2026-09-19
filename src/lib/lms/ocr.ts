import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { KINDS, OMR_READ, PAPER, QUESTION_COUNT, SUBJECT, UNITS, UNIT_GROUPS, paperSummary } from '@/config/lms';
import { mergeReads, normalizeExtracted, type OcrResult, type OmrReadResult } from './ocr-rows';
import { callTimeoutMs, canWaitFor, retryWaitMs, shouldRetry, type CallBudget, type RetryInfo } from './retry';

/** 사진을 읽는 모델. 정답표와 OMR 이 같이 쓴다. */
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
export { normalizeExtracted, type OcrResult, type OcrRow, type OmrReadResult } from './ocr-rows';

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

/* ───────────────────────────────────────────────── OMR 에서 학생 답 읽기 */

/**
 * 받을 모양. 사진에 **보이는** 문항만 적게 한다 — OMR 을 반씩 나눠 찍으면 한 장에 안 보이는
 * 번호가 있다. 안 보인 번호는 아예 안 적고, 보였는데 마킹이 없는 번호는 null 로 적는다.
 */
const OMR_SCHEMA = {
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
            description: '학생이 마킹한 답. 5지선다는 1–5, 단답형은 0–999. 마킹이 없거나 알아볼 수 없으면 null',
          },
          sure: {
            type: 'boolean',
            description: '마킹(또는 비워 둔 것)이 분명하면 true. 조금이라도 헷갈리면 false',
          },
          note: {
            type: ['string', 'null'],
            description: 'sure 가 false 일 때 이유 한 줄 (예: "②와 ④ 둘 다 마킹"). 아니면 null',
          },
        },
        required: ['no', 'answer', 'sure', 'note'],
        additionalProperties: false,
      },
    },
    unreadable_photos: {
      type: 'array',
      items: { type: 'integer' },
      description: '흐리거나 잘리거나 너무 어두워 읽을 수 없는 사진의 번호(1부터)',
    },
    note: { type: 'string', description: '무엇이 보였고 무엇이 어려웠는지 한국어 두 문장 이내' },
  },
  required: ['answers', 'unreadable_photos', 'note'],
  additionalProperties: false,
} as const;

const OMR_SYSTEM = `너는 한국 수능형 ${SUBJECT.name} 실전 모의고사의 답안지(OMR 카드) 사진을 보고, 학생이 문항마다 **마킹한 답**을 옮겨 적는 일을 한다.
채점은 하지 않는다. 정답은 모른다고 생각하고, 문제를 풀어 답을 짐작하지 마라. 학생이 표시한 것만 옮긴다.

시험지 모양은 정해져 있다:
${paperGuide()}

OMR 에서 답을 찾는 곳:
- ${KINDS.choice}: 번호마다 ①–⑤ 칸이 있다. 까맣게 칠한 칸의 번호를 1–5 로 적는다.
- ${KINDS.short}: 번호마다 백 · 십 · 일의 자리 세로줄이 있고 줄마다 0–9 칸이 있다. 자리마다 칠한 칸을 읽어
  정수로 적는다(칠하지 않은 윗자리는 0 — 백의 자리가 비고 십 1 · 일 7 이면 17). 칸 위에 손으로 쓴 숫자가 있으면
  마킹과 맞춰 본다.
- 선택과목 문항(23–30번)은 학생이 칠한 선택과목과 상관없이 23–30번 칸에 칠한 것을 옮긴다.

지켜야 할 것:
- 이 사진들에 **보이는 문항만** 적는다. 사진에 없는 번호는 적지 않는다.
- 보이는 문항인데 칠한 칸이 없으면 answer 는 null, sure 는 true 다 (학생이 비워 둔 문항).
- 한 문항에 두 칸 이상 칠했거나, 지운 자국과 칠한 칸을 가리기 어렵거나, 흐려서 알아볼 수 없으면
  sure 를 false 로 두고 note 에 이유를 짧게 적는다. 사람이 그 문항만 다시 본다.
- 단답형에서 손으로 쓴 숫자와 마킹이 다르거나, 숫자만 쓰고 마킹이 없으면 마킹을(없으면 숫자를) answer 에 적고
  sure 를 false 로 둔다.
- 답안지가 아니라 문제지를 찍었으면 문제지에 표시한 답을 옮기되, 모두 sure 를 false 로 둔다.
- 학생 이름 · 수험번호 · 학교 같은 개인 정보는 어디에도 적지 않는다.
- 흐리거나 잘려서 읽을 수 없는 사진은 unreadable_photos 에 그 사진 번호를 적는다.`;

/** 시간 계산을 바꿔 쓸 수 있게 받는다 — 시험은 몇 초짜리 예산으로 돌린다. */
export type ReadTiming = {
  /** 읽기 전체의 마감 시각(ms). 모든 요청과 재시도 기다림이 여기 안에 든다. */
  deadline?: number;
  minCallMs?: number;
  reserveMs?: number;
  callTimeoutMs?: number;
  maxRetries?: number;
};

/**
 * OMR 사진에서 학생 답을 읽는다. 사진은 한두 장이라 한 번에 보낸다 — 반씩 나눠 찍은 두 장을 따로
 * 보내면 가운데 번호가 겹치거나 끊긴다. 두 장에 같은 번호가 보이면 합칠 때 맞춰 본다 (ocr-rows.ts).
 *
 * 선생님이 화면 앞에서 기다린다. 마감 시각(deadline)을 넘기지 않는다 — 재시도는 여기서 직접
 * 세고(retry.ts), 시각이 되면 보내던 요청도 끊고 TIMEOUT 을 돌려준다. 서버 함수가 먼저 끊기면
 * 화면은 이유도 모른 채 멈춘다.
 */
export async function readOmr(images: OcrImage[], opts: ReadTiming = {}): Promise<OmrReadResult> {
  if (!ocrConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (images.length === 0) return { ok: false, reason: 'NO_IMAGE' };

  const timing: CallBudget & { deadline: number; maxRetries: number } = {
    deadline: opts.deadline ?? Date.now() + OMR_READ.budgetMs,
    minCallMs: opts.minCallMs ?? OMR_READ.minCallMs,
    reserveMs: opts.reserveMs ?? OMR_READ.reserveMs,
    maxCallMs: opts.callTimeoutMs ?? OMR_READ.callTimeoutMs,
    maxRetries: opts.maxRetries ?? OMR_READ.maxRetries,
  };

  const client = new Anthropic();
  const controller = new AbortController();
  const stopAt = setTimeout(() => controller.abort(), Math.max(0, timing.deadline - timing.reserveMs - Date.now()));
  const signal = controller.signal;

  const params = {
    model: OCR_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' as const },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: OMR_SYSTEM,
    messages: [
      {
        role: 'user' as const,
        content: [
          ...images.flatMap((img, k) => [
            { type: 'text' as const, text: `사진 ${k + 1} / ${images.length}` },
            {
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.media_type as 'image/jpeg', data: img.data },
            },
          ]),
          {
            type: 'text' as const,
            text: `위 OMR 사진 ${images.length}장에 보이는 문항마다 학생이 마킹한 답을 옮겨줘.`,
          },
        ],
      },
    ],
    // 무엇이 칠해져 있는지 보는 일이라 깊이 생각할수록 나아지지 않는다. 한 단계 낮춰 빠르게 돈다.
    output_config: { effort: 'medium' as const, format: betaJSONSchemaOutputFormat(OMR_SCHEMA) },
  };

  try {
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) return { ok: false, reason: 'TIMEOUT' };
      const timeout = callTimeoutMs(timing.deadline, Date.now(), timing);
      if (timeout === null) return { ok: false, reason: 'TIMEOUT' };

      try {
        // 재시도는 SDK 에 맡기지 않는다 (retry.ts 머리말).
        const response = await client.beta.messages.parse(params, { timeout, maxRetries: 0, signal });

        if (response.stop_reason === 'refusal') return { ok: false, reason: 'REFUSED' };
        const parsed = response.parsed_output;
        if (!parsed) return { ok: false, reason: 'UNREADABLE' };

        const { answers, unreadable } = mergeReads(parsed.answers, parsed.unreadable_photos, images.length);
        if (answers.every((a) => !a.sure && a.answer === null)) return { ok: false, reason: 'UNREADABLE' };
        return { ok: true, answers, unreadable, note: (parsed.note ?? '').trim().slice(0, 500) };
      } catch (error) {
        if (signal.aborted) return { ok: false, reason: 'TIMEOUT' };
        const reason = reasonOf(error);
        const info = retryInfoOf(error);
        const last = !info || !shouldRetry(info) || attempt >= timing.maxRetries;
        const wait = info ? retryWaitMs(info, attempt) : 0;
        if (last || !canWaitFor(timing.deadline, Date.now(), wait, timing)) {
          console.error('[lms] OMR 읽기 요청 실패', reason, error instanceof Error ? error.message : error);
          return { ok: false, reason };
        }
        if (!(await pause(wait, signal))) return { ok: false, reason: 'TIMEOUT' };
      }
    }
  } finally {
    clearTimeout(stopAt);
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
