'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { OMR_READ, OMR_READ_ERRORS } from '@/config/lms';
import { normalizeImage } from '@/lib/image';
import type { OmrReadResult, ReadAnswer } from '@/lib/lms/ocr-rows';
import type { OmrFill } from '@/lib/lms/omr-fill';
import { btn, btnGhost } from './Shell';

/** 채점표가 읽은 답을 칸에 채우고 돌려주는 요약 */
export type OmrApplied = Pick<OmrFill, 'filled' | 'check' | 'blanks' | 'changed' | 'unkeyed'>;

const nos = (list: number[]) => list.join(', ');

/**
 * 채점 화면 위의 'OMR 사진으로 채우기'.
 *
 * 선생님이 수업에서 걷은 학생의 OMR 을 찍어 올리면 마킹한 답을 읽어 아래 채점표 칸을 채운다.
 * 저장은 하지 않는다 — 칸을 보고 저장을 눌러야 채점이 된다. 애매하게 읽힌 문항은 칸을 비워 두고
 * 노랗게 두른다. 찍은 사진은 이 화면에서만 보여 주고 서버에 남기지 않는다.
 */
export function OmrReader({
  action,
  attemptId,
  configured,
  onRead,
}: {
  action: (formData: FormData) => Promise<OmrReadResult>;
  attemptId: string;
  configured: boolean;
  onRead: (answers: ReadAnswer[]) => OmrApplied;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: OmrApplied; unreadable: number[]; note: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 읽는 30초 동안 선생님이 다른 칸을 매길 수 있다. 읽기가 끝났을 때 그 순간의 칸 위에 채우도록
  // 가장 최근에 받은 onRead 를 부른다 — 고를 때의 것을 부르면 그사이 매긴 칸이 덮인다.
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  // 미리 보기 주소는 브라우저 메모리를 잡는다. 바꾸거나 화면을 떠날 때 놓아 준다.
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  async function run(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setDone(null);

    // 원본 사진은 4000px 넘는 것이 흔하다. 그대로 보내면 서버 함수 상한(6MB)에 걸린다.
    setBusy('사진 줄이는 중…');
    const form = new FormData();
    form.set('attempt_id', attemptId);
    const urls: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, OMR_READ.maxPhotos)) {
        const shrunk = await normalizeImage(file);
        form.append('photo', new File([shrunk.blob], shrunk.name, { type: 'image/jpeg' }));
        urls.push(shrunk.previewUrl);
      }
    } catch {
      urls.forEach((url) => URL.revokeObjectURL(url));
      setBusy('');
      setError(OMR_READ_ERRORS.NOT_JPEG);
      return;
    }
    setPreviews(urls);

    setBusy('읽는 중… 30초쯤 걸려요');
    startTransition(async () => {
      try {
        const result = await action(form);
        if (result.ok) {
          setDone({ applied: onReadRef.current(result.answers), unreadable: result.unreadable, note: result.note });
        } else {
          setError(OMR_READ_ERRORS[result.reason] ?? OMR_READ_ERRORS.UNKNOWN);
        }
      } catch {
        setError(OMR_READ_ERRORS.UNKNOWN);
      }
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  if (!configured) {
    return (
      <div className="glass-inset rounded-xl p-3">
        <p className="text-[13px] leading-[1.6] text-muted">
          OMR 사진으로 채우기가 꺼져 있어요. Vercel 환경변수에 <span className="font-bold">ANTHROPIC_API_KEY</span> 를
          넣으면 열려요. 그 전까지는 아래 한 줄 넣기나 칸을 눌러 매겨 주세요.
        </p>
      </div>
    );
  }

  const working = pending || Boolean(busy);

  return (
    <div className="glass-inset rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-extrabold">OMR 사진으로 채우기</p>
          <p className="text-[12px] leading-[1.6] text-muted">
            학생 OMR 을 화면에 꽉 차게 찍어 올리면 마킹한 답을 읽어 아래 칸을 채워요. 반씩 찍었으면 두 장까지.
          </p>
        </div>
        <label className={`${done ? btnGhost : btn} cursor-pointer`}>
          {working ? busy || '읽는 중…' : done ? '다시 찍어 읽기' : 'OMR 사진 고르기'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={working}
            onChange={(e) => void run(e.target.files)}
            className="sr-only"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-mark-soft px-3 py-2 text-[13px] font-bold text-mark" role="alert">
          {error}
        </p>
      ) : null}

      {done ? (
        <div className="mt-3 flex flex-col gap-1.5 text-[13px] leading-[1.6]" role="status">
          <p className="font-bold">
            {done.applied.filled}문항을 칸에 넣었어요.{' '}
            <span className="text-mark">확인하고 아래 저장을 눌러야 채점이 돼요.</span>
          </p>
          {done.applied.check.length > 0 ? (
            <p className="rounded-lg bg-check-soft px-3 py-2 font-bold text-check">
              확인할 문항 {done.applied.check.length}개: {nos(done.applied.check)}
              <span className="font-normal"> — 칸을 비워 두고 노랗게 표시했어요. 사진을 보고 직접 매겨 주세요.</span>
            </p>
          ) : (
            <p className="text-muted">애매하게 읽힌 문항은 없어요.</p>
          )}
          {done.applied.changed.length > 0 ? (
            <p className="font-bold text-mark">이미 매겨 둔 것과 달라진 문항: {nos(done.applied.changed)}</p>
          ) : null}
          {done.applied.blanks.length > 0 ? (
            <p className="text-muted">마킹이 없어 틀림으로 매긴 문항: {nos(done.applied.blanks)}</p>
          ) : null}
          {done.applied.unkeyed.length > 0 ? (
            <p className="text-muted">정답이 비어 있어 O/X 는 비워 둔 문항: {nos(done.applied.unkeyed)}</p>
          ) : null}
          {done.unreadable.length > 0 ? (
            <p className="font-bold text-danger">
              흐리거나 잘려서 읽지 못한 사진이 있어요 ({done.unreadable.map((i) => `${i + 1}번째`).join(', ')}).
            </p>
          ) : null}
          {done.note ? <p className="text-[12px] text-muted">읽은 메모: {done.note}</p> : null}
        </div>
      ) : null}

      {previews.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {previews.map((url, i) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer" className="block">
                {/* 브라우저에만 있는 미리 보기라 next/image 최적화 대상이 아니다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`OMR 사진 ${i + 1}`}
                  className="max-h-72 w-auto rounded-lg border border-line"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 사진이 밖으로 나간다는 사실은 숨기지 않는다. */}
      <p className="mt-3 text-[12px] leading-[1.6] text-muted">
        사진은 읽는 동안에만 Anthropic 서버로 보내지고 어디에도 저장하지 않아요.
      </p>
    </div>
  );
}
