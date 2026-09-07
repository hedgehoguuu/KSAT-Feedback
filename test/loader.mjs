/**
 * 시험을 돌릴 때만 쓰는 모듈 해석기.
 *
 * app 코드는 `@/config/lms` 처럼 별칭으로, 그리고 `./db` 처럼 확장자 없이 서로를 부른다.
 * 둘 다 번들러(Next)가 풀어 주는 것이라 맨몸의 node 는 못 찾는다. 몇몇 파일은 `server-only`
 * 도 들여오는데 그것은 '이 파일은 서버 전용' 이라는 표시일 뿐 하는 일이 없다.
 *
 * 시험을 위해 app 코드를 상대경로로 고치는 것은 앞뒤가 바뀐 일이라, 여기서 풀어 준다.
 * 시험이 앱을 있는 그대로 보게 하려는 것이다.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY = 'data:text/javascript,export {}';
const TRY = ['.ts', '.tsx', '.mts', '.js', '/index.ts'];

/** 확장자를 붙여 가며 실제로 있는 파일을 찾는다. 없으면 null. */
function firstThatExists(base) {
  if (existsSync(base) && path.extname(base)) return base;
  for (const ext of TRY) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: EMPTY, shortCircuit: true };

  let base = null;
  if (specifier.startsWith('@/')) {
    base = path.join(root, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (base) {
    const found = firstThatExists(base);
    // format 은 정하지 않는다 — node 가 .ts 를 보고 스스로 타입을 벗긴다.
    // 여기서 'module' 이라고 못 박으면 타입이 안 벗겨져 `as const` 에서 터진다.
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  return next(specifier, context);
}
