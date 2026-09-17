/**
 * 모델 요청을 다시 보낼지, 얼마나 기다릴지, 이번 요청에 시간을 얼마나 줄지 — 시간 계산만 있다.
 * 순수 계산이라 시험이 시계를 고정해 그대로 부른다.
 *
 * SDK 의 자동 재시도를 쓰지 않는 까닭: 재시도마다 제한 시간을 처음부터 다시 주고, 서버가
 * Retry-After 로 오래 기다리라고 하면 그만큼 그대로 잔다. 그러면 사진 읽기 한 판이 서버 함수의
 * 시간 상한(300초)을 넘기고, 넘기는 순간 함수가 끊겨 '실패' 조차 못 적는다. 그래서 끄고,
 * 전체 마감 시각을 기준으로 여기서 직접 센다.
 */

export type RetryInfo = {
  /** HTTP 상태. 연결이 끊겼거나 시간이 다 됐으면 없다. */
  status?: number;
  headers?: { get(name: string): string | null } | null;
  /** 연결 단계의 실패 (끊김 · 응답 시간 초과) */
  connection?: boolean;
};

export type CallBudget = {
  /** 끝에 남겨 둘 시간. 결과나 실패를 DB 에 적을 몫이다. */
  reserveMs: number;
  /** 이보다 짧게 남으면 새로 보내지 않는다 */
  minCallMs: number;
  /** 요청 한 번에 주는 시간의 상한 */
  maxCallMs: number;
};

/** 다시 보내 볼 만한 실패인가. 기준은 SDK 와 같다 — 서버가 알려 주면(x-should-retry) 그대로 따른다. */
export function shouldRetry(info: RetryInfo): boolean {
  const hint = info.headers?.get('x-should-retry');
  if (hint === 'true') return true;
  if (hint === 'false') return false;
  if (info.connection) return true;
  const status = info.status;
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}

/**
 * 다음 시도까지 기다릴 시간(ms). 서버가 말한 대로 하고(retry-after-ms · retry-after 초 · 날짜),
 * 말이 없으면 0.5초부터 두 배씩 늘린다(최대 8초). attempt 는 방금 실패한 시도의 순번(0부터)이다.
 */
export function retryWaitMs(info: RetryInfo, attempt: number, now: number = Date.now()): number {
  const millis = parseFloat(info.headers?.get('retry-after-ms') ?? '');
  if (Number.isFinite(millis)) return Math.max(0, millis);

  const after = info.headers?.get('retry-after');
  if (after) {
    const seconds = parseFloat(after);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(after);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

/** 이번 요청에 줄 시간. 끝에 남길 몫을 빼고도 minCallMs 가 안 남으면 null — 보내지 않는다. */
export function callTimeoutMs(deadline: number, now: number, budget: CallBudget): number | null {
  const left = deadline - now - budget.reserveMs;
  if (left < budget.minCallMs) return null;
  return Math.min(left, budget.maxCallMs);
}

/** 기다린 뒤에도 요청 한 번을 보낼 시간이 남는가 */
export function canWaitFor(deadline: number, now: number, waitMs: number, budget: CallBudget): boolean {
  return now + waitMs + budget.minCallMs + budget.reserveMs <= deadline;
}
