import { NextResponse } from 'next/server';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { isSubjectCode } from '@/config/subjects';

export const runtime = 'nodejs';

// 제출 전이라 접수번호가 아직 없다. 초안 id 로 쌓아두고 BE-2(제출) 에서 접수번호와 묶는다.
//
// 경로에 순번을 쓰면 안 된다. 사진을 지웠다가 다시 올릴 때 같은 순번이 다시 나와
// 먼저 올린 파일을 덮어쓴다. 사진마다 고유한 id 를 쓰고, 순서는 제출할 때 따로 보낸다.
export function storagePath(draftId: string, subject: string, fileId: string) {
  return `raw/drafts/${draftId}/${subject}/${fileId}.jpg`;
}

const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { draftId, subject, fileId } = (body ?? {}) as {
    draftId?: string;
    subject?: string;
    fileId?: string;
  };

  if (!draftId || !ID_SHAPE.test(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 });
  }
  if (!subject || !isSubjectCode(subject)) {
    return NextResponse.json({ error: 'invalid subject' }, { status: 400 });
  }
  if (!fileId || !ID_SHAPE.test(fileId)) {
    return NextResponse.json({ error: 'invalid fileId' }, { status: 400 });
  }

  const path = storagePath(draftId, subject, fileId);
  const db = supabaseAdmin();

  if (!db) {
    // 키가 없는 로컬 환경 — ②단계를 끝까지 돌려볼 수 있게 mock 으로 응답한다
    return NextResponse.json({ mode: 'mock', path });
  }

  const { data, error } = await db.storage.from(RAW_BUCKET).createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'signed url failed' }, { status: 500 });
  }

  return NextResponse.json({ mode: 'supabase', path: data.path, signedUrl: data.signedUrl });
}
