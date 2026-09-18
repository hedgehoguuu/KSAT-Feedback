'use client';

import { useReadWatch } from './useReadWatch';

/**
 * 채점 화면에서 사진 읽기가 끝나기를 기다린다. 끝나거나 멈추면 화면이 한 번 새로 그려진다.
 * 읽기를 새로 부를 때마다 key 를 바꿔 다시 붙인다 (부르는 쪽이 읽기 번호를 key 로 준다).
 */
export function ReadWatcher({ url, active }: { url: string; active: boolean }) {
  const { active: watching, notice, stoppedBy } = useReadWatch(url, active);

  if (notice) {
    return (
      <p className="mt-2 rounded-lg bg-check-soft px-3 py-2 text-[13px] font-bold leading-[1.6] text-check" role="status">
        사진 읽기가 끝났거나 멈췄어요. 읽은 결과나 &lsquo;다시 읽기&rsquo; 를 보려면 새로고침하세요 — 매기던 것은
        사라져요. 매기던 것을 지키려면 먼저 저장하세요. 그사이 사진 채점이 채워졌으면 저장하기 전에 바뀐 문항을
        짚어 드려요.
      </p>
    );
  }
  if (watching) {
    return (
      <p className="mt-1 text-[12px] text-muted" aria-live="polite">
        끝나면 이 화면이 저절로 바뀌어요.
      </p>
    );
  }
  // 끝났다는 답을 받아 화면을 새로 그리는 중이다.
  if (stoppedBy !== 'late') return <p className="mt-1 text-[12px] text-muted">결과를 불러오는 중이에요…</p>;
  // 오래 기다려 새로 그렸는데도 아직 읽는 중이면 여기로 온다 (그사이 사진이 또 바뀐 경우 등).
  return <p className="mt-1 text-[12px] text-muted">오래 걸리고 있어요. 조금 뒤에 새로고침해 주세요.</p>;
}
