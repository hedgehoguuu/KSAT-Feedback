import 'server-only';
import { CONCERN } from '@/config/lms';
import { db, must, one, rows } from './db';
import { paths, putFile, removeFilesQuietly } from './files';
import { concernOrder, isConcernTopic } from './paper';

/**
 * 시험 뒤의 질문과 튜터의 답 (lms_concerns). 한 문항에 한 줄 — 질문 하나와 답 하나.
 *
 *   학생   문항마다 막힌 것을 적어 '제출' 한다. 답이 달린 질문은 못 고친다(DB 가 막는다).
 *   튜터   다음 수업 전까지 질문마다 답을 단다 (글, 또는 손으로 쓴 풀이 사진).
 *
 * 다 단 뒤 PDF 로 묶어 보내는 것은 feedback.ts 에 있다.
 */

export type ConcernRow = {
  id: string;
  attempt_id: string;
  /** 0 = 시험 전체 */
  question_no: number;
  body: string;
  answer: string | null;
  answer_image_path: string | null;
  /** 튜터 답이 마지막으로 바뀐 시각 */
  answered_at: string | null;
  created_at: string;
  /** 학생이 질문을 마지막으로 고친 시각. 튜터 답으로는 안 바뀐다. */
  updated_at: string;
};

const CONCERN_COLS =
  'id, attempt_id, question_no, body, answer, answer_image_path, answered_at, created_at, updated_at';

/** 글이든 사진이든 답이 있으면 단 것이다. */
export function isAnswered(c: Pick<ConcernRow, 'answer' | 'answer_image_path'>): boolean {
  return Boolean(c.answer?.trim()) || Boolean(c.answer_image_path);
}

export type Progress = { total: number; answered: number; missing: number[] };

export function progressOf(concerns: Pick<ConcernRow, 'question_no' | 'answer' | 'answer_image_path'>[]): Progress {
  const missing = concerns.filter((c) => !isAnswered(c)).map((c) => c.question_no);
  return { total: concerns.length, answered: concerns.length - missing.length, missing };
}

/* ───────────────────────────────────────────────────────────── 학생 질문 */

export async function listConcerns(attemptId: string): Promise<ConcernRow[]> {
  const found = await rows<ConcernRow>(
    db().from('lms_concerns').select(CONCERN_COLS).eq('attempt_id', attemptId).order('question_no'),
  );
  return found.sort((a, b) => concernOrder(a.question_no, b.question_no));
}

export type ConcernDraft = { question_no: number; body: string };

/**
 * 폼에서 온 질문을 거른다. 버리지 않고 이유를 돌려준다 — 적어 둔 질문이 말없이 사라지면
 * 학생은 보냈다고 믿고 답을 기다린다.
 *
 * 같은 문항이 두 번 오면 한 질문으로 합친다(한 문항에 한 줄이다). 빈 칸은 그냥 빈 칸이다.
 */
export function cleanConcerns(input: { question_no: number; body: string }[]): {
  drafts: ConcernDraft[];
  problem: string | null;
} {
  const merged = new Map<number, string[]>();
  for (const item of input) {
    const body = item.body.replace(/\r\n?/g, '\n').trim();
    if (!body) continue;
    if (!isConcernTopic(item.question_no)) return { drafts: [], problem: 'NO' };
    merged.set(item.question_no, [...(merged.get(item.question_no) ?? []), body]);
  }

  const drafts = [...merged].map(([question_no, bodies]) => ({ question_no, body: bodies.join('\n\n') }));
  // DB 는 글자 수(code point)로 센다. JS 의 length 는 이모지를 두 칸으로 세므로 맞춰 센다.
  if (drafts.some((d) => Array.from(d.body).length > CONCERN.maxBody)) return { drafts: [], problem: 'LONG' };
  return { drafts: drafts.sort((a, b) => concernOrder(a.question_no, b.question_no)), problem: null };
}

/**
 * 학생 질문을 통째로 맞춘다 (0015 save_concerns). 답이 달린 질문은 DB 가 지켜 준다.
 * 답 PDF 가 이미 나갔으면 'LOCKED'.
 */
export async function saveConcerns(
  attemptId: string,
  drafts: ConcernDraft[],
  submit: boolean,
): Promise<'OK' | 'LOCKED'> {
  const { error } = await db().rpc('save_concerns', {
    payload: { attempt_id: attemptId, submit, concerns: drafts },
  });
  if (error?.code === 'P0001' && error.message === 'FEEDBACK_SENT') return 'LOCKED';
  if (error) throw error;
  return 'OK';
}

/* ───────────────────────────────────────────────────────────── 튜터 답 */

/** 여러 질문의 답을 한 번에 저장한다 (0015 save_concern_answers). 답이 달린 질문 수를 돌려준다. */
export async function saveConcernAnswers(
  attemptId: string,
  answers: { id: string; answer: string }[],
): Promise<number> {
  const { data, error } = await db().rpc('save_concern_answers', {
    payload: { attempt_id: attemptId, answers },
  });
  if (error) throw error;
  return Number(data ?? 0);
}

async function concernOf(attemptId: string, concernId: string): Promise<ConcernRow | null> {
  return await one<ConcernRow>(
    db().from('lms_concerns').select(CONCERN_COLS).eq('id', concernId).eq('attempt_id', attemptId).maybeSingle(),
  );
}

/**
 * 손으로 쓴 풀이 사진을 붙인다. 이미 있으면 바꾼다.
 * 새 파일을 올리고 → 줄을 고치고 → 옛 파일을 지운다. 줄을 못 고치면 새 파일을 도로 지운다.
 */
export async function setAnswerImage(
  attemptId: string,
  concernId: string,
  bytes: Uint8Array,
): Promise<'OK' | 'NOT_FOUND'> {
  const concern = await concernOf(attemptId, concernId);
  if (!concern) return 'NOT_FOUND';

  const path = paths.answerImage(attemptId, concernId);
  await putFile(path, bytes, 'image/jpeg');
  try {
    // updated_at 은 '학생이 질문을 고친 시각' 이라 여기서 건드리지 않는다.
    await must(
      db()
        .from('lms_concerns')
        .update({ answer_image_path: path, answered_at: new Date().toISOString() })
        .eq('id', concern.id),
    );
  } catch (error) {
    await removeFilesQuietly([path]);
    throw error;
  }

  await removeFilesQuietly([concern.answer_image_path]);
  return 'OK';
}

/**
 * 풀이 사진을 뗀다. 줄을 먼저 고치고 파일을 지운다 — 파일이 남는 것은 튜터 필기 한 장이지만,
 * 줄이 없는 파일을 가리키면 답변 화면과 PDF 에 깨진 사진이 뜬다.
 */
export async function clearAnswerImage(attemptId: string, concernId: string): Promise<void> {
  const concern = await concernOf(attemptId, concernId);
  if (!concern?.answer_image_path) return;

  await must(
    db()
      .from('lms_concerns')
      .update({
        answer_image_path: null,
        answered_at: concern.answer ? concern.answered_at : null,
      })
      .eq('id', concern.id),
  );
  await removeFilesQuietly([concern.answer_image_path]);
}
