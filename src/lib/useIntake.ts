'use client';

import { useEffect, useState } from 'react';
import { INTAKE_DEFAULTS } from '@/config/app';

export type IntakeState = {
  open: boolean;
  reason: string;
  disabledSubjects: string[];
  loading: boolean;
};

const FALLBACK: IntakeState = {
  open: INTAKE_DEFAULTS.open,
  reason: INTAKE_DEFAULTS.closedReason,
  disabledSubjects: [],
  loading: true,
};

// 한 번 읽어서 세션 동안 재사용한다. 스위치를 바꿨을 때는 새로고침하면 반영된다.
let cached: IntakeState | null = null;

/** 접수 스위치 (OPS-1). 못 읽으면 열어 둔 채로 둔다 — 접수를 놓치는 쪽이 더 나쁘다. */
export function useIntake(): IntakeState {
  const [state, setState] = useState<IntakeState>(cached ?? FALLBACK);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetch('/api/intake', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const next: IntakeState = data
          ? {
              open: Boolean(data.open),
              reason: data.reason ?? INTAKE_DEFAULTS.closedReason,
              disabledSubjects: Array.isArray(data.disabledSubjects) ? data.disabledSubjects : [],
              loading: false,
            }
          : { ...FALLBACK, loading: false };
        cached = next;
        if (alive) setState(next);
      })
      .catch(() => {
        const next = { ...FALLBACK, loading: false };
        cached = next;
        if (alive) setState(next);
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
