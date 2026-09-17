'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { watchDelay, watchStep } from '@/lib/lms/photo-read-state';
import { isDirty } from './dirty';

/**
 * 사진 읽기가 끝날 때까지 가끔 상태만 묻고, 끝나면 화면을 한 번 새로 그린다.
 *
 * 화면 전체를 주기적으로 새로 그리지 않는 이유: 사진 주소가 그릴 때마다 새로 만들어져서
 * 휴대폰이 같은 사진을 계속 다시 받는다. 여기서는 작은 상태 주소(read-status)만 묻는다.
 *
 * 언제 묻고 언제 그만두는지는 photo-read-state.ts 의 WATCH 가 정한다 — 서버가 '멈춤' 으로
 * 판정하는 때보다 오래 지켜본다. 그래야 서버에서 읽기가 끊겼을 때도 '다시 읽기' 가 나온다.
 *
 * 저장 안 한 채점이 있으면 새로 그리지 않고 notice 를 켠다. 화면이 알리고, 사람이 고른다.
 */
export function useReadWatch(url: string, initiallyActive: boolean) {
  const router = useRouter();
  const [active, setActive] = useState(initiallyActive);
  // watch() 를 부를 때마다 는다. 이미 기다리는 중에 새 읽기가 불려도 시계를 처음부터 다시 잰다.
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState(false);
  // 왜 그만 물었나 — changed: 끝났거나 멈췄다는 답을 받았다 · late: 기다릴 만큼 기다렸다
  const [stoppedBy, setStoppedBy] = useState<'changed' | 'late' | null>(null);

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const tick = async () => {
      let kind: string | undefined;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) kind = ((await res.json()) as { kind?: string }).kind;
      } catch {
        // 한 번 못 물었다고 그만두지 않는다. 다음 차례에 다시 묻는다.
      }
      if (stopped) return;

      const elapsed = Date.now() - started;
      if (watchStep(kind, elapsed) === 'refresh') {
        setActive(false);
        setStoppedBy(kind !== undefined && kind !== 'reading' ? 'changed' : 'late');
        if (isDirty()) setNotice(true);
        else router.refresh();
        return;
      }
      timer = setTimeout(tick, watchDelay(elapsed));
    };

    timer = setTimeout(tick, watchDelay(0));
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, round, url, router]);

  const watch = useCallback(() => {
    setNotice(false);
    setStoppedBy(null);
    setActive(true);
    setRound((r) => r + 1);
  }, []);

  return { active, notice, stoppedBy, watch };
}
