'use client';

import { useRef, useState, useTransition } from 'react';
import { LMS, UPLOAD_MESSAGES } from '@/config/lms';
import { normalizeImage } from '@/lib/image';
import { useReadWatch } from './useReadWatch';

/**
 * 학생이 자기 시험지를 찍어 올리는 칸.
 *
 * 한 장씩 줄여서(긴 변 2000px JPEG) 한 장씩 보낸다. 고른 순간부터 미리보기가 뜨고,
 * 실패한 장만 '다시 올리기' 가 뜬다 — 접수 흐름(UploadSection)과 같은 태도다.
 * 원본은 메모리에만 들고 있어서 새로고침하면 실패한 장은 다시 골라야 한다.
 *
 * 사진이 바뀌면 서버가 조금 뒤에 사진에서 답을 읽는다(자동 채점). 여기서는 그것이 끝나기를
 * 기다렸다가 화면을 한 번 새로 그린다 — 흐려서 못 읽은 사진이 있으면 그 사진에 표시가 붙는다.
 */

type Upload = { ok: true; photo: { id: string; url: string | null }; read?: string } | { ok: false; reason: string };
type Result = { ok: boolean; reason?: string; read?: string };

type Item = {
  key: string;
  id: string | null;
  url: string | null;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  blob?: Blob;
};

let seq = 0;
const nextKey = () => `p${Date.now()}-${seq++}`;

export function PaperPhotos({
  examId,
  initial,
  locked,
  upload,
  remove,
  move,
  reading = false,
  unreadable = [],
}: {
  examId: string;
  initial: { id: string; url: string | null }[];
  /** 답이 이미 나간 시험. 보기만 한다. */
  locked: boolean;
  upload: (form: FormData) => Promise<Upload>;
  remove: (form: FormData) => Promise<Result>;
  move: (form: FormData) => Promise<Result>;
  /** 화면을 그릴 때 사진 읽기가 도는 중이었다 */
  reading?: boolean;
  /** 흐려서 못 읽은 사진 */
  unreadable?: string[];
}) {
  const [items, setItems] = useState<Item[]>(() =>
    initial.map((p) => ({ key: p.id, id: p.id, url: p.url, status: 'done' as const })),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const reader = useReadWatch(`/lms/me/exams/${examId}/read-status`, reading);
  const blurry = new Set(unreadable);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...next } : it)));

  /** 올린 사진 한 장. 서버가 읽기를 불렀으면 참. */
  async function send(key: string, blob: Blob): Promise<boolean> {
    patch(key, { status: 'uploading', error: undefined });
    const form = new FormData();
    form.set('exam_id', examId);
    form.set('photo', new File([blob], 'paper.jpg', { type: 'image/jpeg' }));
    try {
      const out = await upload(form);
      if (out.ok) {
        patch(key, { status: 'done', id: out.photo.id, blob: undefined });
        return out.read === 'QUEUED';
      }
      patch(key, { status: 'error', error: UPLOAD_MESSAGES[out.reason] ?? UPLOAD_MESSAGES.FAILED });
    } catch {
      patch(key, { status: 'error', error: UPLOAD_MESSAGES.FAILED });
    }
    return false;
  }

  async function retry(key: string, blob: Blob) {
    if (await send(key, blob)) reader.watch();
  }

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setNotice(null);

    const room = LMS.maxPhotos - items.length;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/') || f.type === '');
    const files = picked.slice(0, Math.max(0, room));
    if (files.length < picked.length) setNotice(`사진은 ${LMS.maxPhotos}장까지예요. ${files.length}장만 올렸어요.`);
    if (files.length === 0) return;

    setBusy(true);
    let queued = false;
    // 서버 함수는 한 번에 하나씩 돈다(Next 가 줄을 세운다). 순서대로 보내 화면 순서와 저장 순서를 맞춘다.
    for (const file of files) {
      const key = nextKey();
      try {
        const shrunk = await normalizeImage(file);
        setItems((prev) => [...prev, { key, id: null, url: shrunk.previewUrl, status: 'uploading', blob: shrunk.blob }]);
        if (await send(key, shrunk.blob)) queued = true;
      } catch {
        setNotice('열 수 없는 사진이 있었어요. 다른 사진으로 올려주세요.');
      }
    }
    setBusy(false);
    if (queued) reader.watch();
  }

  function drop(item: Item) {
    if (!item.id) {
      setItems((prev) => prev.filter((it) => it.key !== item.key));
      return;
    }
    const form = new FormData();
    form.set('exam_id', examId);
    form.set('photo_id', item.id);
    startTransition(async () => {
      const out: Result = await remove(form).catch(() => ({ ok: false, reason: 'FAILED' }));
      if (out.ok) {
        setItems((prev) => prev.filter((it) => it.key !== item.key));
        if (out.read === 'QUEUED') reader.watch();
      } else {
        setNotice(UPLOAD_MESSAGES[out.reason ?? 'FAILED'] ?? UPLOAD_MESSAGES.FAILED);
      }
    });
  }

  function shift(item: Item, step: -1 | 1) {
    const index = items.findIndex((it) => it.key === item.key);
    const target = index + step;
    if (!item.id || target < 0 || target >= items.length) return;
    const form = new FormData();
    form.set('exam_id', examId);
    form.set('photo_id', item.id);
    form.set('step', step < 0 ? 'up' : 'down');
    startTransition(async () => {
      const out = await move(form).catch(() => ({ ok: false, reason: 'FAILED' }));
      if (!out.ok) {
        setNotice(UPLOAD_MESSAGES[out.reason ?? 'FAILED'] ?? UPLOAD_MESSAGES.FAILED);
        return;
      }
      setItems((prev) => {
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    });
  }

  const failed = items.filter((it) => it.status === 'error').length;
  const uploading = items.filter((it) => it.status === 'uploading').length;
  const working = busy || pending || uploading > 0;
  const blurryCount = items.filter((it) => it.id && blurry.has(it.id)).length;

  return (
    <div>
      <p
        className={`text-[14px] font-bold ${failed > 0 ? 'text-danger' : items.length > 0 && !working ? 'text-success' : ''}`}
        aria-live="polite"
      >
        {uploading > 0
          ? `올리는 중… ${uploading}장 남았어요`
          : failed > 0
            ? `${failed}장이 안 올라갔어요`
            : items.length > 0
              ? `시험지 ${items.length}장을 받았어요`
              : '아직 올린 사진이 없어요'}
      </p>

      {!locked ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="min-h-12 rounded-xl bg-surface text-[14px] font-semibold active:bg-line disabled:opacity-50"
          >
            카메라로 찍기
          </button>
          <button
            type="button"
            onClick={() => albumRef.current?.click()}
            disabled={busy}
            className="min-h-12 rounded-xl bg-surface text-[14px] font-semibold active:bg-line disabled:opacity-50"
          >
            앨범에서 고르기
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void onPick(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={albumRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void onPick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      ) : null}

      {notice ? (
        <p className="mt-2 text-[13px] text-muted" role="status">
          {notice}
        </p>
      ) : null}

      {!locked && reader.active && !working ? (
        <p className="mt-2 text-[13px] text-muted" aria-live="polite">
          사진에서 답을 읽고 있어요. 1–3분 뒤에 끝나요 — 이 화면을 닫아도 괜찮아요.
        </p>
      ) : null}
      {!locked && !reader.active && blurryCount > 0 ? (
        <p className="mt-2 rounded-xl bg-mark-soft px-3 py-2 text-[13px] font-bold leading-[1.6] text-mark" role="status">
          흐리거나 잘려서 답을 읽지 못한 사진이 {blurryCount}장 있어요. 그 사진을 지우고 다시 찍어 올려주세요.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((item, i) => (
            <li key={item.key} className="flex flex-col gap-1">
              <div className="relative aspect-3/4 overflow-hidden rounded-xl bg-surface">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                    {/* 비공개 저장소의 임시 주소 · 로컬 미리보기라 next/image 최적화 대상이 아니다 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={`시험지 ${i + 1}쪽`} className="h-full w-full object-cover" />
                  </a>
                ) : (
                  <span className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] text-muted">
                    {i + 1}쪽 · 미리보기를 못 불러왔어요
                  </span>
                )}

                {item.status === 'uploading' ? (
                  <span className="absolute inset-x-0 bottom-0 bg-brand/85 py-1 text-center text-[11px] font-bold text-white">
                    올리는 중
                  </span>
                ) : null}

                {item.status === 'done' && item.id && blurry.has(item.id) ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-mark/90 py-1 text-center text-[11px] font-bold text-white">
                    흐려요 · 다시 찍어주세요
                  </span>
                ) : null}

                {item.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => item.blob && void retry(item.key, item.blob)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/15 px-1 text-center text-[12px] font-semibold text-danger"
                  >
                    <span>{item.blob ? '다시 올리기' : '다시 골라주세요'}</span>
                    <span className="text-[10px] font-normal">{item.error}</span>
                  </button>
                ) : null}
              </div>

              {!locked ? (
                <div className="flex items-center justify-between gap-1">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`${i + 1}쪽을 앞으로`}
                      disabled={i === 0 || !item.id || working}
                      onClick={() => shift(item, -1)}
                      className="h-8 w-8 rounded-lg text-[13px] text-muted disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label={`${i + 1}쪽을 뒤로`}
                      disabled={i === items.length - 1 || !item.id || working}
                      onClick={() => shift(item, 1)}
                      className="h-8 w-8 rounded-lg text-[13px] text-muted disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => drop(item)}
                    disabled={item.status === 'uploading' || pending}
                    className="h-8 px-1 text-[12px] text-muted disabled:opacity-30"
                  >
                    삭제
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !locked ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          문제지에 풀이한 흔적이 그대로 보이게 찍어주세요. 구겨져도, 필기가 많아도 괜찮아요 — 그게 더 도움돼요.
        </p>
      ) : null}
    </div>
  );
}
