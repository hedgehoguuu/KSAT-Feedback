import 'server-only';
import { INTAKE_DEFAULTS } from '@/config/app';
import { supabaseAdmin } from './supabase/admin';

export type Intake = {
  open: boolean;
  reason: string;
  disabledSubjects: string[];
  /** 오늘 남은 자리. 하루 상한이 없으면 null */
  remainingToday: number | null;
};

/**
 * 접수 스위치 (OPS-1). Supabase `app_settings` 한 줄을 읽는다 — 배포 없이 바꿀 수 있다.
 *
 * 닫히는 경우는 셋이다.
 *   ① 손으로 껐을 때 (intake_open = false)
 *   ② 통틀어 상한(capacity)에 닿았을 때
 *   ③ 하루 상한(daily_capacity)에 닿았을 때 — 한국 날짜가 바뀌면 저절로 다시 열린다
 *
 * 읽기에 실패하면 열어 둔 채로 둔다 (접수를 놓치는 쪽이 더 나쁘다).
 * 화면을 닫는 건 여기까지고, 실제로 막는 건 create_submission 안에서 한 번 더 한다.
 */
export async function readIntake(): Promise<Intake> {
  const db = supabaseAdmin();
  if (!db) {
    return {
      open: INTAKE_DEFAULTS.open,
      reason: INTAKE_DEFAULTS.closedReason,
      disabledSubjects: [],
      remainingToday: null,
    };
  }

  const { data, error } = await db
    .from('app_settings')
    .select('intake_open, capacity, daily_capacity, closed_reason, daily_closed_reason, disabled_subjects')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    return {
      open: true,
      reason: INTAKE_DEFAULTS.closedReason,
      disabledSubjects: [],
      remainingToday: null,
    };
  }

  const disabledSubjects: string[] = data.disabled_subjects ?? [];
  const reason = data.closed_reason ?? INTAKE_DEFAULTS.closedReason;
  const dailyReason = data.daily_closed_reason ?? INTAKE_DEFAULTS.dailyClosedReason;

  if (!data.intake_open) return { open: false, reason, disabledSubjects, remainingToday: null };

  if (typeof data.capacity === 'number' && data.capacity > 0) {
    const { count } = await db.from('submissions').select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= data.capacity) {
      return { open: false, reason, disabledSubjects, remainingToday: 0 };
    }
  }

  const dailyCap = data.daily_capacity;
  if (typeof dailyCap === 'number' && dailyCap > 0) {
    // 발급한 접수번호를 센다 — 한국 날짜 기준이고, 테스트 접수를 지워도 줄지 않는다.
    const { data: today, error: countError } = await db.rpc('today_receipt_count');
    // 못 세면 막지 않는다. 상한 때문에 멀쩡한 접수를 놓치는 쪽이 더 나쁘다.
    if (!countError && typeof today === 'number') {
      const remaining = Math.max(0, dailyCap - today);
      if (remaining === 0) {
        return { open: false, reason: dailyReason, disabledSubjects, remainingToday: 0 };
      }
      return { open: true, reason, disabledSubjects, remainingToday: remaining };
    }
  }

  return { open: true, reason, disabledSubjects, remainingToday: null };
}
