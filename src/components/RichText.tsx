import { Fragment } from 'react';
import { markedInline } from '@/components/Marked';

/**
 * 관리자가 적은 여러 줄 글을 서식과 함께 그린다. 편집기 라이브러리를 붙이지 않고
 * 적는 규칙만 정했다 — 관리자 화면에서 그대로 타이핑하면 된다.
 *
 *   ## 큰 제목        → 조금 큰 굵은 줄
 *   ### 작은 제목     → 작은 굵은 줄
 *   - 항목            → 점 목록 (• 로 적어도 된다)
 *   **굵게**          → 굵은 글씨
 *   __밑줄__          → 밑줄
 *   *강조*            → 빨간펜 밑줄
 *   빈 줄             → 문단 나누기
 *
 * 관리자가 적은 글은 React 가 그대로 글자로 그리므로 HTML 이 섞여도 실행되지 않는다.
 */
type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'para'; lines: string[] };

const HEADING = /^(#{2,3})\s+(.+)$/;
const BULLET = /^[-•]\s+(.+)$/;

function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flush = () => {
    if (list.length > 0) {
      blocks.push({ kind: 'list', items: list });
      list = [];
    }
    if (para.length > 0) {
      blocks.push({ kind: 'para', lines: para });
      para = [];
    }
  };

  for (const raw of source.split('\n')) {
    const line = raw.trim();

    if (!line) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length === 2 ? 2 : 3, text: heading[2] });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (para.length > 0) flush();
      list.push(bullet[1]);
      continue;
    }

    if (list.length > 0) flush();
    para.push(line);
  }

  flush();
  return blocks;
}

export function RichText({ text }: { text: string }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p
              key={i}
              className={
                block.level === 2
                  ? 'text-[16px] font-bold leading-[1.5] text-foreground'
                  : 'text-[14px] font-bold leading-[1.5] text-foreground'
              }
            >
              {markedInline(block.text)}
            </p>
          );
        }

        if (block.kind === 'list') {
          return (
            <ul key={i} className="flex flex-col gap-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-[14px] leading-[1.65] text-muted">
                  <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-mark" aria-hidden />
                  <span>{markedInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="text-[14px] leading-[1.7] text-muted">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {markedInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
