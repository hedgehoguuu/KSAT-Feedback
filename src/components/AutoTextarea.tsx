'use client';

import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
};

/** 내용에 맞춰 높이가 늘어나는 입력창. 글자 수는 세지 않는다 — 압박을 주지 않으려고. (FE-5 AC) */
export function AutoTextarea({ value, onChange, placeholder, id }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      id={id}
      ref={ref}
      rows={2}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-xl border border-line bg-background px-4 py-3 text-[16px] leading-[1.55] outline-none placeholder:text-muted focus:border-brand"
    />
  );
}
