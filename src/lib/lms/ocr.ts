import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { KINDS, PAPER, QUESTION_COUNT, SUBJECT, UNITS, UNIT_GROUPS, paperSummary } from '@/config/lms';
import { normalizeExtracted, type OcrResult } from './ocr-rows';

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
      model: 'claude-opus-5',
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
    // 무엇이 잘못됐는지에 따라 화면이 다른 말을 해야 한다. 좁은 것부터 본다.
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, reason: 'BAD_KEY' };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: 'RATE_LIMIT' };
    if (error instanceof Anthropic.APIError) return { ok: false, reason: 'API_ERROR' };
    return { ok: false, reason: 'UNKNOWN' };
  }
}
