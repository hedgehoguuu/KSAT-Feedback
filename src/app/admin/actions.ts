'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isApplicationStatus,
  isClassStatus,
  isSlug,
  CLASS,
} from '@/config/class';
import { ADMIN_COOKIE, assertAdmin, issueSession, passwordMatches } from '@/lib/admin';
import {
  deleteClass,
  removeProof,
  saveClass,
  setApplicationStatus,
  uploadProof,
  type ClassInput,
} from '@/lib/classes';

/**
 * 서버 함수는 화면을 거치지 않고 POST 로 바로 불릴 수 있다.
 * 그래서 모든 쓰기가 맨 앞에서 assertAdmin() 을 부른다 — 화면만 막는 건 잠근 게 아니다.
 */

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const v = text(form, key);
  return v.length > 0 ? v : null;
}

/**
 * 숫자 칸. 빈 칸이면 기본값이다 — Number('') 은 0 이라 그냥 넘기면
 * 회차와 수강료가 조용히 0 이 된다.
 */
function number(form: FormData, key: string, fallback: number): number {
  const raw = text(form, key);
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  if (!passwordMatches(password)) redirect('/admin/login?error=1');

  const session = issueSession();
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  });
  redirect('/admin');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

export async function saveClassAction(formData: FormData): Promise<void> {
  await assertAdmin();

  const slug = text(formData, 'slug').toLowerCase();
  const status = text(formData, 'status');

  // 되돌아갈 곳. 새 반이면 아직 /admin/class/[slug] 가 없어서 그리로 보내면 404 가 뜨고,
  // 관리자는 적던 것을 통째로 잃는다. 폼이 숨은 칸으로 어디서 왔는지 알려준다.
  const form = text(formData, 'mode') === 'new' ? '/admin/class/new' : `/admin/class/${slug}`;
  const back = (message: string): never => redirect(`${form}?error=${encodeURIComponent(message)}`);

  if (!isSlug(slug)) back('주소(slug)는 영문 소문자·숫자·하이픈으로 적어주세요');

  const input: ClassInput = {
    slug,
    title: text(formData, 'title'),
    schedule_text: text(formData, 'schedule_text'),
    starts_on: optional(formData, 'starts_on'),
    sessions: number(formData, 'sessions', CLASS.defaultSessions),
    location: text(formData, 'location'),
    tutor_name: text(formData, 'tutor_name'),
    tutor_school: optional(formData, 'tutor_school'),
    tutor_percentile: optional(formData, 'tutor_percentile')
      ? number(formData, 'tutor_percentile', 0)
      : null,
    recommend: optional(formData, 'recommend'),
    detail: optional(formData, 'detail'),
    capacity: number(formData, 'capacity', CLASS.defaultCapacity),
    price: number(formData, 'price', CLASS.defaultPrice),
    price_note: text(formData, 'price_note') || CLASS.defaultPriceNote,
    status: isClassStatus(status) ? status : 'draft',
    sort_order: number(formData, 'sort_order', 0),
  };

  const problem =
    !input.title ? '반 이름을 적어주세요'
    : !input.schedule_text ? '시간을 적어주세요'
    : input.capacity < 1 || input.capacity > 20 ? '모집 인원은 1~20명 사이예요'
    : input.price < 0 ? '수강료를 다시 확인해주세요'
    : null;

  if (problem) back(problem);

  let failure: string | null = null;
  try {
    await saveClass(input);
  } catch (err) {
    failure = err instanceof Error ? err.message : '저장이 안 됐어요';
  }

  if (failure) back(failure);
  redirect('/admin?saved=1');
}

export async function deleteClassAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const slug = text(formData, 'slug');

  let failure: string | null = null;
  try {
    await deleteClass(slug);
  } catch (err) {
    failure = err instanceof Error ? err.message : '지우지 못했어요';
  }

  if (failure) redirect(`/admin/class/${slug}?error=${encodeURIComponent(failure)}`);
  redirect('/admin');
}

export async function uploadProofAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const slug = text(formData, 'slug');
  const file = formData.get('proof');

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/class/${slug}?error=${encodeURIComponent('올릴 이미지를 골라주세요')}`);
  }

  let failure: string | null = null;
  try {
    await uploadProof(slug, file as File);
  } catch (err) {
    failure = err instanceof Error ? err.message : '올리지 못했어요';
  }

  redirect(failure ? `/admin/class/${slug}?error=${encodeURIComponent(failure)}` : `/admin/class/${slug}`);
}

export async function removeProofAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const slug = text(formData, 'slug');
  await removeProof(slug, text(formData, 'path'));
  redirect(`/admin/class/${slug}`);
}

export async function setApplicationStatusAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = text(formData, 'id');
  const status = text(formData, 'status');
  if (id && isApplicationStatus(status)) await setApplicationStatus(id, status);
  redirect('/admin/applications');
}
