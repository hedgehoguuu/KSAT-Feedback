import { NextResponse } from 'next/server';
import { readIntake } from '@/lib/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 랜딩·업로드 화면이 접수 상태를 확인한다. 캐시하지 않는다 — 스위치는 즉시 반영돼야 한다. */
export async function GET() {
  const intake = await readIntake();
  return NextResponse.json(intake, { headers: { 'cache-control': 'no-store' } });
}
