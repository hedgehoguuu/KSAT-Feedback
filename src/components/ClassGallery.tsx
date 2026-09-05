'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 개설 클래스가 둘 이상이면 옆으로 넘겨 보는 갤러리가 된다.
 *
 * 폰에서 카드를 세로로 쌓으면 두 번째 반을 보려고 한참을 내려야 하고, 두 반을 나란히
 * 견주지도 못한다. 가로로 두고 다음 카드를 살짝 걸쳐 보여주면 "더 있다"가 바로 읽힌다.
 *
 * 하나뿐이면 그냥 한 장으로 둔다 — 넘길 것이 없는데 넘기는 시늉을 만들지 않는다.
 */
export function ClassGallery({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const many = count > 1;

  useEffect(() => {
    const el = ref.current;
    if (!el || !many) return;

    const items = Array.from(el.children) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            setActive(items.indexOf(entry.target as HTMLElement));
          }
        }
      },
      { root: el, threshold: [0.6] },
    );

    items.forEach((item) => io.observe(item));
    return () => io.disconnect();
  }, [many, count]);

  // 점을 눌러도 이동할 수 있게. block:'nearest' 라 세로 위치는 건드리지 않는다.
  const goTo = useCallback((index: number) => {
    const item = ref.current?.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, []);

  // 하나뿐이면 넘길 것이 없으니 그냥 한 장. li 의 점 표시만 지운다.
  if (!many) return <ul className="mt-5 list-none">{children}</ul>;

  return (
    <div className="mt-5">
      <ul
        ref={ref}
        className="-mx-5 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto scroll-pl-5 px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>

      <div className="mt-4 flex items-center justify-center gap-2">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`${i + 1}번째 반 보기`}
            aria-current={i === active}
            className="p-1.5"
          >
            <span
              className={[
                'block rounded-full transition-all',
                i === active ? 'h-2 w-5 bg-mark' : 'size-2 bg-line',
              ].join(' ')}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
