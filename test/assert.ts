/**
 * 아주 작은 단언 도구.
 *
 * 시험 틀을 따로 들이지 않았다. 이 저장소가 확인해야 하는 것은 '점수가 맞게 나오는가',
 * '못 읽었을 때 조용히 넘어가지 않는가' 같은 것뿐이라, 통과·실패를 세고 색을 입히는
 * 스무 줄이면 충분하다. 의존성이 하나 늘면 그것도 관리 대상이 된다.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

export function section(title: string): void {
  console.log(`\n${BOLD}${title}${OFF}`);
}

/** 참이면 통과. 아니면 무엇이 나왔는지까지 적는다 — '실패' 만 있으면 고칠 수가 없다. */
export function ok(name: string, condition: boolean, got?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ${GREEN}ok${OFF}   ${name}`);
    return;
  }
  failed += 1;
  const detail = got === undefined ? '' : `  → ${typeof got === 'string' ? got : JSON.stringify(got)}`;
  failures.push(name);
  console.log(`  ${RED}FAIL${OFF} ${name}${detail}`);
}

export function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} (기대: ${JSON.stringify(want)})`);
}

/** 던져야 하는 것이 던지는지. 안 던지면 그게 버그다. */
export async function throws(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    ok(name, false, '던지지 않았다');
  } catch {
    ok(name, true);
  }
}

/** 맨 끝에서 부른다. 하나라도 실패하면 종료 코드가 1 이라 CI 가 잡는다. */
export function done(): never {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`${RED}실패:${OFF}\n${failures.map((f) => `  · ${f}`).join('\n')}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}
