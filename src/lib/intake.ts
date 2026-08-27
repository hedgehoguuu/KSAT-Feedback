import 'server-only';
import { INTAKE_DEFAULTS } from '@/config/app';
import { supabaseAdmin } from './supabase/admin';

export type Intake = {
  open: boolean;
  reason: string;
  disabledSubjects: string[];
};

/**
 * 접수 스위치 (OPS-1). Supabase `app_settings` 한 줄을 읽는다 — 배포 없이 바꿀 수 있다.
 * 상한(capacity)에 닿으면 자동으로 닫는다. 읽기에 실패하면 열어 둔 채로 둔다(접수를 놓치는 쪽이 더 나쁘다).
 */
export async function readIntake(): Promise<Intake> {
  const db = supabaseAdmin();
  if (!db) {
    return {
      open: INTAKE_DEFAULTS.open,
      reason: INTAKE_DEFAULTS.closedReason,
      disabledSubjects: [],
    };
  }

  const { data, error } = await db
    .from('app_settings')
    .select('intake_open, capacity, closed_reason, disabled_subjects')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    return { open: true, reason: INTAKE_DEFAULTS.closedReason, disabledSubjects: [] };
  }

  const reason = data.closed_reason ?? INTAKE_DEFAULTS.closedReason;
  if (!data.intake_open) {
    return { open: false, reason, disabledSubjects: data.disabled_subjects ?? [] };
  }

  if (typeof data.capacity === 'number' && data.capacity > 0) {
    const { count } = await db.from('submissions').select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= data.capacity) {
      return { open: false, reason, disabledSubjects: data.disabled_subjects ?? [] };
    }
  }

  return { open: true, reason, disabledSubjects: data.disabled_subjects ?? [] };
}
