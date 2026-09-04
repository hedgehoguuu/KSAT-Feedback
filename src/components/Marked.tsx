import { Fragment } from 'react';

/**
 * 문구 파일(class-copy.ts)의 두 가지 표시를 화면으로 옮긴다.
 *   *별표로 감싼 말* → 빨간펜 밑줄
 *   \n              → 줄바꿈
 */
export function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, li) => (
        <Fragment key={li}>
          {li > 0 ? <br /> : null}
          {line.split('*').map((part, pi) =>
            pi % 2 === 1 ? (
              <span key={pi} className="pen">
                {part}
              </span>
            ) : (
              <Fragment key={pi}>{part}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}
