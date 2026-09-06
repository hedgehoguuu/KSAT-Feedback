'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** 비활성일 때 버튼 아래에 문장으로 보여줄 이유 (FE-3 AC) */
  reason?: string | null;
  /**
   * 실패했을 때 보여줄 말. reason 과 자리는 같지만 빨갛게, 그리고 더 세게 알린다.
   * 예전에는 실패도 reason 으로 흘려보내서, 제출이 안 된 순간이 작은 회색 글씨였다.
   */
  error?: string | null;
  pending?: boolean;
  secondary?: ReactNode;
};

/** 자바스크립트가 재기 전에 쓸 최소 높이. 버튼(52) + 위아래 여백만큼. */
const MIN_HEIGHT = 88;

/**
 * 화면 아래에 떠 있는 버튼 막대.
 *
 * 예전에는 sticky 였다. 그러면 막대가 내용 '뒤'가 아니라 '다음'에 놓여서, 짧은 화면에서는
 * 그냥 바닥에 붙은 흰 띠가 된다 — 글이 그 아래로 지나가질 않으니 유리를 씌워도 비칠 게 없다.
 *
 * 그래서 막대는 화면에 고정(fixed)하고, 흐름에는 같은 높이의 빈 자리를 대신 남긴다.
 * 이제 내용이 막대 아래로 지나가고, 끝까지 내려도 마지막 줄이 막대에 가리지 않는다.
 * 높이는 재서 넣는다 — '이유' 문장이 붙고 빠지면서 높이가 달라지기 때문이다.
 */
export function BottomBar({ label, onClick, disabled, reason, error, pending, secondary }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* 막대가 흐름에서 빠진 만큼 자리를 비워 둔다. mt-auto 는 내용이 짧을 때 아래로 민다. */}
      <div aria-hidden className="mt-auto shrink-0" style={{ height }} />

      <div
        ref={barRef}
        className="glass glass-bar fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] rounded-t-2xl border-x-0 border-b-0 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3.5"
      >
        {secondary}
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || pending}
          className="min-h-13 w-full rounded-2xl bg-brand px-4 text-[16px] font-bold text-white shadow-[0_8px_20px_-8px_rgb(49_130_246/0.7)] transition-colors active:bg-brand-pressed disabled:bg-foreground/10 disabled:text-muted disabled:shadow-none"
        >
          {pending ? '보내는 중…' : label}
        </button>
        {error ? (
          <p
            className="mt-2.5 rounded-xl bg-danger/10 px-3 py-2.5 text-center text-[13px] font-semibold leading-[1.5] text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : reason ? (
          <p className="mt-2 text-center text-[13px] text-muted" role="status">
            {reason}
          </p>
        ) : null}
      </div>
    </>
  );
}
