'use client';

import type { ReactNode } from 'react';

type Props = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** 비활성일 때 버튼 아래에 문장으로 보여줄 이유 (FE-3 AC) */
  reason?: string | null;
  pending?: boolean;
  secondary?: ReactNode;
};

export function BottomBar({ label, onClick, disabled, reason, pending, secondary }: Props) {
  return (
    // 내용 위에 떠서 같이 스크롤되는 막대 — 유리가 원래 있어야 할 자리다.
    // 위쪽만 테두리를 두고 아래·옆은 화면에 붙인다.
    <div className="glass-solid sticky bottom-0 z-20 mt-auto rounded-t-2xl border-x-0 border-b-0 px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3.5">
      {secondary}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || pending}
        className="min-h-13 w-full rounded-2xl bg-brand px-4 text-[16px] font-bold text-white transition-colors active:bg-brand-pressed disabled:bg-line disabled:text-muted"
      >
        {pending ? '보내는 중…' : label}
      </button>
      {reason ? (
        <p className="mt-2 text-center text-[13px] text-muted" role="status">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
