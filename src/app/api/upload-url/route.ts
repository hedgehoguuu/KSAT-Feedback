import { NextResponse } from 'next/server';
import { RAW_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { isSubjectCode } from '@/config/subjects';

export const runtime = 'nodejs';

// 제출 전이라 접수번호가 아직 없다. 초안 id 로 쌓아두고 BE-2(제출) 에서 접수번호와 묶는다.
function storagePath(draftId: string, subject: string, order: number) {
  return `raw/drafts/${draftId}/${subject}/${String(order).padStart(2, '0')}.jpg`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { draftId, subject, order } = (body ?? {}) as {
    draftId?: string;
    subject?: string;
    order?: number;
  };

  if (!draftId || !/^[a-zA-Z0-9-]{8,64}$/.test(draftId)) {
    return NextResponse.json({ error: 'invalid draftId' }, { status: 400 });
  }
  if (!subject || !isSubjectCode(subject)) {
    return NextResponse.json({ error: 'invalid subject' }, { status: 400 });
  }
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 999) {
    return NextResponse.json({ error: 'invalid order' }, { status: 400 });
  }

  const path = storagePath(draftId, subject, order);
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
