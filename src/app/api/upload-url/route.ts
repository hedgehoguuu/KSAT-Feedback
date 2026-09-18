import { NextResponse } from 'next/server';
import { isSubjectCode } from '@/config/subjects';
import { draftPhotoPath, isIdShape } from '@/lib/intake/paths';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// 사진 한 장을 올릴 일회용 서명 주소. 경로 모양은 lib/intake/paths.ts 에 있다 — 제출이 같은 것을 본다.

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

  if (!isIdShape(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 });
  }
  if (!subject || !isSubjectCode(subject)) {
    return NextResponse.json({ error: 'invalid subject' }, { status: 400 });
  }
  if (!isIdShape(fileId)) {
    return NextResponse.json({ error: 'invalid fileId' }, { status: 400 });
  }

  const path = draftPhotoPath(draftId, subject, fileId);
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
