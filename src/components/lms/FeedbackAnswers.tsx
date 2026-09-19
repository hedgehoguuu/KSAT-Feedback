'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { CONCERN, UPLOAD_MESSAGES } from '@/config/lms';
import { normalizeImage } from '@/lib/image';
import { btn, btnGhost } from './Shell';

/**
 * 학생 질문에 답을 다는 화면.
 *
 * 질문마다 글로 답하거나, 손으로 쓴 풀이를 찍어 붙인다(둘 다 해도 된다). 수식은 글로 치는 것보다
 * 종이에 쓰고 찍는 편이 빠르고 정확하다.
 *
 * '보내기' 는 질문이 전부 답을 받았을 때만 눌린다. 누르면 먼저 저장하고, 서버가 한 번 더 확인한
 * 뒤 PDF 를 만들어 보낸다. 쓰던 답을 저장하지 않고 창을 닫으려 하면 한 번 묻는다.
 */

export type ConcernView = {
  id: string;
  topic: string;
  meta: string;
  mark: 'o' | 'x' | null;
  body: string;
  answer: string;
  imageUrl: string | null;
  hasImage: boolean;
  updatedLate: boolean;
};

type Result = { ok: true } | { ok: false; reason: string };
type ImageState = { url: string | null; has: boolean; busy: boolean; error?: string };

export function FeedbackAnswers({
  attemptId,
  action,
  uploadImage,
  removeImage,
  concerns,
  sentAt,
  studentName,
  mailTo,
  previewHref,
  scored,
}: {
  attemptId: string;
  action: (form: FormData) => Promise<void>;
  uploadImage: (form: FormData) => Promise<Result>;
  removeImage: (form: FormData) => Promise<Result>;
  concerns: ConcernView[];
  /** 이미 보냈으면 그 시각(화면용 글자) */
  sentAt: string | null;
  studentName: string;
  mailTo: string | null;
  previewHref: string;
  /** 채점이 끝나 PDF 에 점수가 들어가는가 */
  scored: boolean;
}) {
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(concerns.map((c) => [c.id, c.answer])),
  );
  const [images, setImages] = useState<Record<string, ImageState>>(() =>
    Object.fromEntries(concerns.map((c) => [c.id, { url: c.imageUrl, has: c.hasImage, busy: false }])),
  );
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const answered = concerns.filter((c) => texts[c.id]?.trim() || images[c.id]?.has);
  const missing = concerns.filter((c) => !(texts[c.id]?.trim() || images[c.id]?.has));
  const uploading = Object.values(images).some((i) => i.busy);
  const ready = concerns.length > 0 && missing.length === 0 && !uploading;

  const patchImage = (id: string, next: Partial<ImageState>) =>
    setImages((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));

  async function attach(id: string, file: File | undefined) {
    if (!file) return;
    patchImage(id, { busy: true, error: undefined });
    try {
      const shrunk = await normalizeImage(file);
      const form = new FormData();
      form.set('attempt_id', attemptId);
      form.set('concern_id', id);
      form.set('photo', new File([shrunk.blob], 'answer.jpg', { type: 'image/jpeg' }));
      const out = await uploadImage(form);
      if (out.ok) patchImage(id, { busy: false, has: true, url: shrunk.previewUrl });
      else patchImage(id, { busy: false, error: UPLOAD_MESSAGES[out.reason] ?? UPLOAD_MESSAGES.FAILED });
    } catch {
      patchImage(id, { busy: false, error: UPLOAD_MESSAGES.FAILED });
    }
  }

  function detach(id: string) {
    patchImage(id, { busy: true, error: undefined });
    const form = new FormData();
    form.set('attempt_id', attemptId);
    form.set('concern_id', id);
    startTransition(async () => {
      const out = await removeImage(form).catch(() => ({ ok: false as const, reason: 'FAILED' }));
      if (out.ok) patchImage(id, { busy: false, has: false, url: null });
      else patchImage(id, { busy: false, error: UPLOAD_MESSAGES[out.reason] ?? UPLOAD_MESSAGES.FAILED });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'send') {
      setDirty(false);
      return;
    }
    if (!ready) {
      event.preventDefault();
      setProblem(
        uploading
          ? '사진을 올리는 중이에요. 끝난 뒤에 보내주세요.'
          : `아직 답을 안 단 질문이 있어요 — ${missing.map((c) => c.topic).join(', ')}`,
      );
      return;
    }
    const lines = [
      `${studentName} 학생에게 답변 PDF 를 ${sentAt ? '다시 ' : ''}보냅니다.`,
      '',
      `· 질문 ${concerns.length}개와 답`,
      scored ? '· 점수와 정오표' : '· 점수는 채점이 끝나지 않아 빠져요',
      mailTo ? `· 메일: ${mailTo}` : '· 학생 메일 주소가 없어 메일은 안 가요 (학생 화면에서 받아요)',
      '',
      sentAt ? '학생은 새 PDF 를 받게 돼요.' : '보낸 뒤에는 학생이 질문을 고칠 수 없어요.',
    ];
    if (!window.confirm(lines.join('\n'))) {
      event.preventDefault();
      return;
    }
    setDirty(false);
  }

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="attempt_id" value={attemptId} />

      <div className="glass-bar sticky top-14 z-10 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-3">
        <p className="text-[13px] font-bold text-muted">
          답 단 질문{' '}
          <span className="ml-1 text-[22px] font-extrabold text-foreground">{answered.length}</span>
          <span className="text-[13px]"> / {concerns.length}</span>
        </p>
        {missing.length > 0 ? (
          <p className="text-[13px] font-bold text-mark">남은 것 {missing.map((c) => c.topic).join(', ')}</p>
        ) : concerns.length > 0 ? (
          <p className="text-[13px] font-bold text-brand">다 달았어요. 보낼 수 있어요.</p>
        ) : null}
        <a href={previewHref} target="_blank" rel="noreferrer" className="ml-auto text-[13px] font-bold text-brand underline underline-offset-2">
          PDF 미리 보기
        </a>
      </div>

      <ol className="flex flex-col gap-4">
        {concerns.map((c) => {
          const image = images[c.id];
          return (
            <li key={c.id} className="glass-inset rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[13px] font-extrabold text-white ${c.mark === 'x' ? 'bg-mark' : 'bg-brand'}`}
                >
                  {c.topic}
                </span>
                <span className="text-[12px] text-muted">{c.meta}</span>
                {c.mark ? (
                  <span className={`text-[12px] font-bold ${c.mark === 'o' ? 'text-brand' : 'text-mark'}`}>
                    {c.mark === 'o' ? '맞힌 문항' : '틀린 문항'}
                  </span>
                ) : null}
                {c.updatedLate ? (
                  <span className="rounded-md bg-mark-soft px-1.5 py-0.5 text-[11px] font-bold text-mark">
                    제출 뒤에 고친 질문
                  </span>
                ) : null}
              </div>

              <p className="mt-3 text-[12px] font-bold text-muted">학생 질문</p>
              <p className="mt-1 whitespace-pre-wrap rounded-xl bg-white/70 px-3 py-2 text-[15px] leading-[1.7]">
                {c.body}
              </p>

              <label className="mt-4 block text-[12px] font-bold text-brand" htmlFor={`answer_${c.id}`}>
                답
              </label>
              <textarea
                id={`answer_${c.id}`}
                name={`answer_${c.id}`}
                value={texts[c.id] ?? ''}
                maxLength={CONCERN.maxAnswer}
                onChange={(e) => {
                  setTexts((prev) => ({ ...prev, [c.id]: e.target.value }));
                  setDirty(true);
                  setProblem(null);
                }}
                rows={5}
                placeholder="무엇을 먼저 봐야 했는지, 다음에 같은 자리에서 무엇을 할지. 풀이 사진만 붙여도 돼요."
                className="mt-1 w-full rounded-xl border border-line bg-white/80 px-3 py-2 text-[15px] leading-[1.7] outline-none focus:border-brand"
              />

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {image?.url ? (
                  <a href={image.url} target="_blank" rel="noreferrer" className="block">
                    {/* 비공개 저장소의 임시 주소 · 로컬 미리보기 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={`${c.topic} 풀이 사진`} className="h-28 w-auto rounded-lg border border-line object-cover" />
                  </a>
                ) : image?.has ? (
                  <span className="text-[12px] text-muted">풀이 사진이 붙어 있어요 (미리보기를 못 불러왔어요)</span>
                ) : null}
                <ImagePicker
                  label={image?.has ? '사진 바꾸기' : '풀이 사진 붙이기'}
                  busy={Boolean(image?.busy)}
                  onPick={(file) => void attach(c.id, file)}
                />
                {image?.has ? (
                  <button
                    type="button"
                    onClick={() => detach(c.id)}
                    disabled={image.busy}
                    className="min-h-10 px-2 text-[13px] font-semibold text-muted hover:text-danger disabled:opacity-40"
                  >
                    사진 떼기
                  </button>
                ) : null}
                {image?.busy ? <span className="text-[12px] text-muted">올리는 중…</span> : null}
                {image?.error ? <span className="text-[12px] font-bold text-danger">{image.error}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {problem ? (
        <p className="rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="save" className={btnGhost}>
          저장
        </button>
        <button
          type="submit"
          name="intent"
          value="send"
          className={`${btn} disabled:opacity-40`}
          aria-disabled={!ready}
        >
          {sentAt ? '저장하고 다시 보내기' : '저장하고 PDF 보내기'}
        </button>
        <p className="text-[13px] leading-[1.6] text-muted">
          {sentAt
            ? `${sentAt}에 보냈어요. 고친 뒤 다시 보내면 학생은 새 PDF 를 받아요.`
            : '질문에 모두 답을 달아야 보낼 수 있어요. 미리 보기는 저장한 내용으로 만들어요.'}
        </p>
      </div>
    </form>
  );
}

function ImagePicker({ label, busy, onPick }: { label: string; busy: boolean; onPick: (file: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`${btnGhost} disabled:opacity-40`}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
