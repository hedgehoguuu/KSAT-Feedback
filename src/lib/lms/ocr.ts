import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { AREAS, AREA_GROUPS, LMS, layoutSummary } from '@/config/lms';
import { normalizeExtracted, type OcrResult } from './ocr-rows';

/**
 * 문항표를 사진에서 읽어 온다.
 *
 * 회차마다 45줄을 손으로 채우는 것이 이 서비스에서 제일 지루한 일이다. 시험지 뒤의
 * 정답표나 배점표를 찍어 올리면 초안을 만들어 준다.
 *
 * 두 가지를 지킨다.
 *
 *   1) **읽은 것만 말한다.** 사진에 영역이 안 적혀 있으면 지어내지 않고 비워서 돌려준다.
 *      비워 온 자리는 앱이 통상 배치로 채우고, 화면이 '이건 사진에서 읽은 게 아니라
 *      배치로 채운 것' 이라고 따로 말해 준다. 지어낸 값이 조용히 저장되는 것이 최악이다.
 *   2) **저장하지 않는다.** 결과는 편집기에 채워 넣기만 하고, 튜터가 눈으로 보고
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
 * 영역은 못 읽었을 수 있으므로 비울 수 있게 둔다. 여기서 억지로 하나를 고르게 하면
 * 모델은 반드시 아무거나 고른다 — 그리고 그게 맞는지 아무도 확인하지 않는다.
 *
 * enum 과 범위는 SDK 가 요청을 보내기 전에 설명 문구로 낮춘다(기본 동작). 즉 이 스키마가
 * 보장하는 것은 **키와 자료형까지**이고, 값이 실제로 목록 안에 있는지는 보장하지 않는다.
 * 그래서 값 검사는 아래 normalizeExtracted() 가 다시 한다 — 거기가 진짜 방어선이다.
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
          no: { type: 'integer', minimum: 1, maximum: LMS.maxQuestionCount, description: '문항 번호' },
          area_code: {
            type: ['string', 'null'],
            enum: [...AREAS.map((a) => a.code), null],
            description: '사진에서 영역을 알 수 있을 때만. 모르면 null',
          },
          points: { type: ['number', 'null'], description: '배점. 사진에 없으면 null' },
          answer: {
            type: ['integer', 'null'],
            enum: [1, 2, 3, 4, 5, null],
            description: '정답 번호. 없으면 null',
          },
          passage: { type: ['string', 'null'], description: '(가)(나) 같은 지문 표시. 없으면 null' },
        },
        required: ['no', 'area_code', 'points', 'answer', 'passage'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: '무엇을 읽었고 무엇이 흐릿했는지 한국어 두 문장 이내' },
  },
  required: ['questions', 'note'],
  additionalProperties: false,
} as const;

function areaGuide(): string {
  return AREAS.map((a) => `- ${a.code}: ${AREA_GROUPS[a.group]} ${a.label}`).join('\n');
}

const SYSTEM = `너는 한국 수능 국어 시험지의 정답표·배점표를 읽어 문항표를 만드는 일을 한다.

쓸 수 있는 영역 코드는 이것뿐이다:
${areaGuide()}

지켜야 할 것:
- 사진에 **실제로 보이는 것만** 적는다. 안 보이면 null 로 둔다. 특히 영역(area_code)은
  지문 제목이나 '독서/문학/화법과작문' 같은 표시가 실제로 보일 때만 채운다.
  번호만 보고 영역을 짐작하지 마라 — 짐작은 이쪽에서 따로 처리한다.
- 배점은 보이는 대로. 한국 국어 시험은 대개 2점이고 몇 문항이 3점이다.
- 정답은 1~5 사이 숫자다. 그 밖의 것이 보이면 null 로 둔다.
- 선택과목(화법과작문·언어와매체)이 둘 다 있으면 **같은 번호를 두 줄로** 적는다.
  35번 화작과 35번 언매는 서로 다른 문항이다.
- 문항 번호 순서대로 준다. 사진에 없는 번호는 만들어 내지 않는다.`;

/**
 * 사진 여러 장을 한 번에 읽는다. 정답표가 두 쪽으로 나뉘어 있는 일이 흔해서
 * 장마다 따로 부르면 번호가 겹치거나 끊긴다.
 */
export async function readQuestionTable(images: OcrImage[], count: number): Promise<OcrResult> {
  if (!ocrConfigured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (images.length === 0) return { ok: false, reason: 'NO_IMAGE' };

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // 표를 정확히 읽는 일이라 대충 훑으면 번호가 밀린다. 생각을 켜 둔다.
      thinking: { type: 'adaptive' },
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
              text: `이 회차는 ${count}문항이다. 사진에서 읽을 수 있는 문항을 전부 뽑아줘.`,
            },
          ],
        },
      ],
      output_config: { format: jsonSchemaOutputFormat(EXTRACTED_SCHEMA) },
    });

    const parsed = response.parsed_output;
    if (!parsed) return { ok: false, reason: 'UNREADABLE' };

    const rows = normalizeExtracted(parsed.questions);
    if (rows.length === 0) return { ok: false, reason: 'UNREADABLE' };

    return {
      ok: true,
      rows,
      note: parsed.note?.trim() || '',
      guessedCount: rows.filter((r) => r.areaGuessed).length,
    };
  } catch (error) {
    // 무엇이 잘못됐는지에 따라 화면이 다른 말을 해야 한다.
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, reason: 'BAD_KEY' };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: 'RATE_LIMIT' };
    if (error instanceof Anthropic.APIError) return { ok: false, reason: 'API_ERROR' };
    return { ok: false, reason: 'UNKNOWN' };
  }
}

/** 화면이 보여줄 문구. 사진을 다시 찍어야 하는 경우와 우리 설정 문제를 구별해 준다. */
export const OCR_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: '사진 읽기가 아직 켜져 있지 않아요. ANTHROPIC_API_KEY 를 넣어야 해요.',
  NO_IMAGE: '사진을 한 장 이상 올려주세요.',
  UNREADABLE: `사진에서 문항표를 못 읽었어요. 정답표나 배점표가 잘 보이게 다시 찍어주세요. (${layoutSummary()} 배치로 직접 만들 수도 있어요)`,
  BAD_KEY: 'API 키가 맞지 않아요. 설정을 확인해주세요.',
  RATE_LIMIT: '지금은 요청이 몰렸어요. 잠시 뒤에 다시 해주세요.',
  API_ERROR: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
  UNKNOWN: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
};
