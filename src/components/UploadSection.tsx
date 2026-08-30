'use client';

import { useState } from 'react';
import { LIMITS, maxPhotosFor } from '@/config/app';
import { subjectLabel, type SubjectCode } from '@/config/subjects';
import { dropBlob, keepBlob, takeBlob } from '@/lib/blobs';
import { getDraftId } from '@/lib/draft';
import { normalizeImage } from '@/lib/image';
import { photosOf, useApply, type Photo } from '@/lib/store';
import { requestUploadTarget, uploadBlob } from '@/lib/upload';

type Batch = { total: number; done: number } | null;

export function UploadSection({ subject }: { subject: SubjectCode }) {
  const photos = useApply((s) => s.photos);
  const addPhotos = useApply((s) => s.addPhotos);
  const patchPhoto = useApply((s) => s.patchPhoto);
  const removePhoto = useApply((s) => s.removePhoto);
  const movePhoto = useApply((s) => s.movePhoto);

  const mine = photosOf(photos, subject);
  const [batch, setBatch] = useState<Batch>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const doneCount = mine.filter((p) => p.status === 'done').length;
  const failedCount = mine.filter((p) => p.status === 'error').length;
  const busy = mine.some((p) => p.status === 'queued' || p.status === 'uploading');

  async function send(photo: Photo, blob: Blob) {
    patchPhoto(photo.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      // 사진 id 를 그대로 경로에 쓴다. 다시 올려도 같은 자리에 덮어써서 쓰레기가 남지 않는다.
      const target = await requestUploadTarget({ draftId: getDraftId(), subject, fileId: photo.id });
      await uploadBlob(target, blob, photo.name, (p) => patchPhoto(photo.id, { progress: p }));
      patchPhoto(photo.id, { status: 'done', progress: 100, storagePath: target.path });
      return true;
    } catch (err) {
      patchPhoto(photo.id, {
        status: 'error',
        error: err instanceof Error ? err.message : '잘 안 올라갔어요',
      });
      return false;
    }
  }

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setNotice(null);

    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    const subjectMax = maxPhotosFor(subject);
    const perSubjectLeft = subjectMax - mine.length;
    const totalLeft = LIMITS.maxPhotosTotal - photos.length;
    const allowed = Math.max(0, Math.min(picked.length, perSubjectLeft, totalLeft));

    if (allowed < picked.length) {
      setNotice(
        totalLeft <= perSubjectLeft
          ? `한 번에 ${LIMITS.maxPhotosTotal}장까지 받을 수 있어요. ${allowed}장만 올렸어요.`
          : `${subjectLabel(subject)}는 ${subjectMax}장까지예요. ${allowed}장만 올렸어요.`,
      );
    }
    if (allowed === 0) return;

    const files = picked.slice(0, allowed);
    setBatch({ total: files.length, done: 0 });

    for (const file of files) {
      try {
        const normalized = await normalizeImage(file);
        const [photo] = addPhotos(subject, [
          {
            name: normalized.name,
            bytes: normalized.blob.size,
            previewUrl: normalized.previewUrl,
          },
        ]);
        keepBlob(photo.id, normalized.blob);
        await send(photo, normalized.blob);
      } catch {
        setNotice('이 사진은 열 수가 없었어요. 다른 사진으로 올려볼래요?');
      }
      setBatch((b) => (b ? { ...b, done: b.done + 1 } : b));
    }

    setBatch(null);
  }

  async function retry(photo: Photo) {
    const blob = takeBlob(photo.id);
    if (!blob) {
      setNotice('새로고침하면서 사진이 사라졌어요. 다시 골라주세요.');
      removePhoto(photo.id);
      return;
    }
    await send(photo, blob);
  }

  function remove(photo: Photo) {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    dropBlob(photo.id);
    removePhoto(photo.id);
  }

  const headline =
    busy && batch
      ? `올리는 중… ${batch.total}장 중 ${batch.done}장`
      : doneCount > 0 && failedCount === 0
        ? `${subjectLabel(subject)} 시험지 ${doneCount}장, 잘 받았어요`
        : failedCount > 0
          ? `${subjectLabel(subject)} · ${failedCount}장이 안 올라갔어요`
          : `${subjectLabel(subject)} 시험지`;

  return (
    <section className="rounded-2xl border border-line p-4">
      <h2
        className={[
          'text-[15px] font-bold',
          failedCount > 0 ? 'text-danger' : doneCount > 0 && !busy ? 'text-success' : 'text-foreground',
        ].join(' ')}
        aria-live="polite"
      >
        {headline}
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-surface text-[14px] font-semibold active:bg-line">
          카메라로 찍기
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void onPick(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-surface text-[14px] font-semibold active:bg-line">
          앨범에서 고르기
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              void onPick(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {notice ? (
        <p className="mt-2 text-[13px] text-muted" role="status">
          {notice}
        </p>
      ) : null}

      {mine.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {mine.map((photo, i) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <div className="relative aspect-3/4 overflow-hidden rounded-xl bg-surface">
                {photo.previewUrl ? (
                  // 로컬 objectURL 미리보기 — next/image 최적화 대상이 아니다
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.previewUrl}
                    alt={`${subjectLabel(subject)} ${i + 1}번째 사진`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] text-muted">
                    {i + 1}번째 사진
                  </span>
                )}

                {photo.status === 'uploading' || photo.status === 'queued' ? (
                  <span className="absolute inset-x-0 bottom-0 h-1.5 bg-line">
                    <span
                      className="block h-full bg-brand transition-[width]"
                      style={{ width: `${photo.progress}%` }}
                    />
                  </span>
                ) : null}

                {photo.status === 'done' ? (
                  <span
                    aria-label="올라감"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white"
                  >
                    ✓
                  </span>
                ) : null}

                {photo.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => void retry(photo)}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/10 text-[12px] font-semibold text-danger"
                  >
                    <span>다시 올리기</span>
                  </button>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-1">
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    aria-label="앞으로"
                    disabled={i === 0}
                    onClick={() => movePhoto(photo.id, -1)}
                    className="h-8 w-8 rounded-lg text-[13px] text-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="뒤로"
                    disabled={i === mine.length - 1}
                    onClick={() => movePhoto(photo.id, 1)}
                    className="h-8 w-8 rounded-lg text-[13px] text-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  className="h-8 px-1 text-[12px] text-muted"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          구겨져도, 필기가 많아도 괜찮아요. 오히려 그게 더 도움돼요.
        </p>
      )}
    </section>
  );
}
