'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** 같은 화면 안에서 순서대로 뜨게 할 때 (ms) */
  delay?: number;
};

/**
 * 화면에 들어오면 한 번 떠오른다. 애플 페이지의 그 움직임이다.
 *
 * 숨기는 것은 CSS 의 `html.js` 아래에만 있어서, 자바스크립트가 안 돌면
 * 처음부터 전부 보인다 — 움직임 때문에 글이 안 보이는 일은 없다.
 * 움직임을 줄이도록 설정한 사람에게는 즉시 보여준다.
 */
export function Reveal({ children, delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('reveal-in');
          io.unobserve(entry.target);
        }
      },
      // 조금 올라온 뒤에 뜨게 해야 '떠오르는' 느낌이 난다
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="reveal" style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
