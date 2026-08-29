import 'server-only';
import { POLICY } from '@/config/app';
import type { Exam } from '@/config/exams';
import { answerText, questionsFor } from '@/config/questions.config';
import { subjectLabel, type SubjectCode } from '@/config/subjects';

const NOTION_VERSION = '2022-06-28';

/**
 * Notion 은 평균 초당 3회로 요청을 제한한다. 넘으면 429 와 함께 얼마나 기다리라고 알려준다.
 * 접수가 몰리면 실제로 걸리므로, 알려준 만큼 기다렸다가 한 번 더 시도한다.
 */
async function notionFetch(url: string, init: RequestInit): Promise<Response> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN 이 없습니다');

  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, { ...init, headers });
  if (res.status !== 429) return res;

  const waitSeconds = Number(res.headers.get('retry-after') ?? '2');
  await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(waitSeconds) ? waitSeconds : 2, 20) * 1000));
  return fetch(url, { ...init, headers });
}

export type NotionInput = {
  receiptNo: string;
  exam: Exam;
  subject: SubjectCode;
  email: string;
  createdAt: string;
  concerns: Record<string, string>;
  photoCount: number;
  pdfUrl: string | null;
};

export function notionConfigured(): boolean {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID);
}

/**
 * 과목 1건 = Notion 1페이지 (BE-5).
 * 속성 이름·타입은 데이터베이스에 만들어 둔 것과 정확히 같아야 한다. 바꾸면 여기도 같이 고쳐야 한다.
 */
export async function createNotionPage(input: NotionInput): Promise<string> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID 가 없습니다');

  const label = subjectLabel(input.subject);

  // 이미 만들어져 있으면 그걸 쓴다.
  // 페이지는 만들어졌는데 그 id 를 저장하지 못한 경우, 다시 돌려도 같은 줄이 두 번 생기지 않는다.
  const existing = await findNotionPageId(input.receiptNo, label);
  if (existing) return existing;

  const properties: Record<string, unknown> = {
    '이름': { title: [{ text: { content: `${input.receiptNo} · ${label}` } }] },
    '접수번호': { rich_text: [{ text: { content: input.receiptNo } }] },
    '학년': { select: { name: `고${input.exam.grade}` } },
    '시험': { select: { name: input.exam.notionLabel } },
    '과목': { select: { name: label } },
    '이메일': { email: input.email },
    '접수일시': { date: { start: input.createdAt } },
    '사진 수': { number: input.photoCount },
    '고민': { rich_text: [{ text: { content: concernSummary(input.subject, input.concerns) } }] },
    '상태': { select: { name: '접수' } },
    '과외 의향': { select: { name: '미확인' } },
  };

  // PDF 병합이 실패했으면 URL 칸을 비워 둔다. 빈 문자열은 Notion 이 거부한다.
  if (input.pdfUrl) properties['시험지 PDF'] = { url: input.pdfUrl };

  const res = await notionFetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      // 문답 전문은 페이지 본문에 넣는다. 속성 칸에 열 문항을 밀어 넣으면 읽을 수가 없다.
      children: concernBlocks(input.subject, input.concerns),
    }),
  });

  const body = (await res.json()) as { id?: string; message?: string };
  if (!res.ok || !body.id) {
    throw new Error(`Notion 등록 실패 (${res.status}) ${body.message ?? ''}`.trim());
  }
  return body.id;
}

/**
 * 이미 만들어 둔 페이지에 시험지 PDF 링크만 채워 넣는다.
 * 등록은 됐는데 PDF 병합이 나중에 성공한 경우, 재처리에서 이 함수가 빈 칸을 메운다.
 */
export async function updateNotionPdfUrl(pageId: string, pdfUrl: string): Promise<void> {
  const res = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { '시험지 PDF': { url: pdfUrl } } }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { message?: string };
    throw new Error(`Notion PDF 링크 갱신 실패 (${res.status}) ${body.message ?? ''}`.trim());
  }
}

/**
 * 속성 칸에 들어갈 한 줄 요약.
 * 열 문항을 그대로 밀어 넣으면 2000자 제한에 걸리고, 표에서 읽히지도 않는다.
 * 목록에서 훑을 때 쓸모 있는 것만 남긴다 — 몇 개 답했는지, 어려웠던 문항, 무엇을 원하는지.
 */
function concernSummary(subject: SubjectCode, answers: Record<string, string>): string {
  const questions = questionsFor(subject);
  const answered = questions.filter((q) => (answers[q.id] ?? '').trim());
  if (answered.length === 0) return '적지 않고 넘어갔어요';

  const parts = [`답변 ${answered.length}/${questions.length}`];

  const hard = questions.find((q) => q.summary === 'hard' && (answers[q.id] ?? '').trim());
  if (hard) parts.push(`어려운 문항 ${answers[hard.id].trim()}`);

  const want = questions.find((q) => q.summary === 'want');
  const wantValue = want ? answerText(want, answers[want.id] ?? '') : '';
  if (wantValue) parts.push(`원하는 것: ${wantValue}`);

  const first = answered.find((q) => q.type === 'long');
  if (first) {
    const text = answers[first.id].trim().replace(/\s+/g, ' ');
    parts.push(text.length > 70 ? `${text.slice(0, 70)}…` : text);
  }

  const line = parts.join(' · ');
  return line.length > 1900 ? `${line.slice(0, 1900)}…` : line;
}

/** 페이지 본문에 들어갈 문답 전문. 답하지 않은 문항은 넣지 않는다. */
function concernBlocks(subject: SubjectCode, answers: Record<string, string>): unknown[] {
  const questions = questionsFor(subject);
  const label = subjectLabel(subject);

  const blocks: unknown[] = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: `${label} — 학생이 적어준 것` } }] },
    },
  ];

  let answeredCount = 0;
  for (const q of questions) {
    const value = answerText(q, answers[q.id] ?? '');
    if (!value) continue;
    answeredCount += 1;
    blocks.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ text: { content: q.label.replace('{subject}', label) } }],
      },
    });
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: chunk(value) },
    });
  }

  if (answeredCount === 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: '적지 않고 넘어갔어요. 시험지만 보고 판단해야 합니다.' } }],
      },
    });
  }

  return blocks;
}

/** Notion 은 조각 하나에 2000자까지만 받는다. 길면 잘라서 여러 조각으로 나눈다. */
function chunk(text: string): { text: { content: string } }[] {
  const size = 1900;
  if (text.length <= size) return [{ text: { content: text } }];
  const out: { text: { content: string } }[] = [];
  for (let i = 0; i < text.length && out.length < 20; i += size) {
    out.push({ text: { content: text.slice(i, i + size) } });
  }
  return out;
}

/** 접수번호 + 과목으로 이미 만들어진 페이지를 찾는다. 없으면 null. */
export async function findNotionPageId(
  receiptNo: string,
  subjectLabelText: string,
): Promise<string | null> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) return null;

  const res = await notionFetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 1,
      filter: {
        and: [
          { property: '접수번호', rich_text: { equals: receiptNo } },
          { property: '과목', select: { equals: subjectLabelText } },
        ],
      },
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { results?: { id: string }[] };
  return body.results?.[0]?.id ?? null;
}

/** 시험지 PDF 는 보관 기간과 같은 유효기간의 서명 URL 로 넣는다 (SEC-1) */
export const PDF_URL_TTL_SECONDS = POLICY.retentionDays * 24 * 60 * 60;
