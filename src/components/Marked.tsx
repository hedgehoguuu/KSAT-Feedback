import { Fragment, type ReactNode } from 'react';

/**
 * 문구 파일(class-copy.ts)과 관리자가 적은 글에서 쓰는 표시를 화면으로 옮긴다.
 *
 *   **굵게**     → 굵은 글씨
 *   __밑줄__     → 밑줄
 *   *강조*       → 빨간펜 밑줄
 *   \n           → 줄바꿈
 *
 * ** 가 * 보다 먼저 잡혀야 하므로 정규식 순서를 바꾸지 말 것.
 */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;

export function markedInline(line: string): ReactNode[] {
  return line.split(INLINE).map((part, i) => {
    if (!part) return null;

    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-extrabold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 4 && part.startsWith('__') && part.endsWith('__')) {
      return (
        <span key={i} className="underline decoration-2 underline-offset-4">
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return (
        <span key={i} className="pen">
          {part.slice(1, -1)}
        </span>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {markedInline(line)}
        </Fragment>
      ))}
    </>
  );
}
