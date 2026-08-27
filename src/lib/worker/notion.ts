import 'server-only';
import { POLICY } from '@/config/app';
import type { Exam } from '@/config/exams';
import { questionsFor } from '@/config/questions.config';
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
    '고민': { rich_text: [{ text: { content: formatConcerns(input.subject, input.concerns) } }] },
    '상태': { select: { name: '접수' } },
    '과외 의향': { select: { name: '미확인' } },
  };

  // PDF 병합이 실패했으면 URL 칸을 비워 둔다. 빈 문자열은 Notion 이 거부한다.
  if (input.pdfUrl) properties['시험지 PDF'] = { url: input.pdfUrl };

  const res = await notionFetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
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

/** 5문항을 사람이 읽을 수 있는 한 덩어리로 합친다. 답이 없는 문항은 빼고 넣는다. */
function formatConcerns(subject: SubjectCode, answers: Record<string, string>): string {
  const lines = questionsFor(subject)
    .map((q) => {
      const raw = (answers[q.id] ?? '').trim();
      if (!raw) return null;
      const value =
        q.type === 'choice'
          ? (q.options?.find((o) => o.value === raw)?.label ?? raw)
          : raw;
      const label = q.label.replace('{subject}', subjectLabel(subject));
      return `${label}\n→ ${value}`;
    })
    .filter((v): v is string => v !== null);

  if (lines.length === 0) return '(적지 않고 넘어갔어요)';
  const text = lines.join('\n\n');
  // Notion rich_text 한 조각의 상한은 2000자다
  return text.length > 1900 ? `${text.slice(0, 1900)}…` : text;
}

/** 접수번호 + 과목으로 이미 만들어진 페이지를 찾는다. 없으면 null. */
export async function findNotionPageId(receiptNo: string, subjectLabelText: string): Promise<string | null> {
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
