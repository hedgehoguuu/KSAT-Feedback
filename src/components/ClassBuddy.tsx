'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BUDDY } from '@/config/class-copy';

type Ask = (typeof BUDDY.asks)[number];
type Line =
  | { role: 'bot'; text: string; action?: Ask['action'] }
  | { role: 'me'; text: string };

/** 관찰이가 대답을 적는 척하는 시간. 이보다 짧으면 그냥 튀어나오고, 길면 기다리게 된다. */
const TYPING_MS = 520;
/** 말풍선을 닫은 뒤 한마디가 다시 떠오르기까지. 곧바로 튀어나오면 닫은 손을 되받아친다. */
const HINT_IN_MS = 1200;

/**
 * 화면 오른쪽 아래에 떠 있는 챗봇 — 관찰이.
 *
 * 이 페이지는 위에서 아래로 길게 읽는 글이다. 다 읽고 나서 "그래서 어떻게 물어보지",
 * "신청은 어디서 하지" 가 생기는데, 그 답은 맨 아래에만 있다. 읽는 도중 어디서든
 * 두 가지를 할 수 있게 하는 것이 이 부품이 하는 일의 전부다.
 *   ① 오픈채팅방으로 물어보기 (바깥 주소)
 *   ② 개설 클래스 목록으로 굴러가기 (#classes)
 *
 * 그래서 '무엇이든 물어보세요' 식의 입력창을 두지 않는다. 답할 사람이 없는 입력창은
 * 물어본 사람을 기다리게만 한다. 물어볼 수 있는 것만 눌러서 물어보게 한다.
 *
 * 글자는 전부 config/class-copy.ts 의 BUDDY 에 있다.
 */
export function ClassBuddy() {
  const [open, setOpen] = useState(false);
  /** 뜸을 들일 만큼 시간이 지났는가. 닫을 때마다 도로 꺼서 다시 뜸을 들인다. */
  const [hintReady, setHintReady] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [thread, setThread] = useState<Line[]>([{ role: 'bot', text: BUDDY.greeting }]);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rest = BUDDY.asks.filter((a) => !asked.includes(a.id));
  const finished = rest.length === 0;
  /** 곁의 한마디는 따로 켜고 끄지 않는다 — '닫혀 있고, 뜸을 다 들였는가' 가 곧 답이다. */
  const hint = Boolean(BUDDY.hint) && !open && hintReady;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    // 닫자마자 한마디가 튀어나오면 닫은 손을 되받아친다. 처음부터 다시 뜸을 들인다.
    setHintReady(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // ── 말풍선이 닫혀 있는 동안 곁에 남는 한마디 ─────────────────────
  // 한 번 보여주고 마는 것이 아니다. 이 페이지는 길어서, 다 읽고 내려온 뒤에야
  // "그래서 어디로 물어보지" 가 떠오른다 — 그때 눈에 들어와야 한다.
  // 열면 사라지고, 닫으면 잠시 뒤 다시 떠오른다.
  useEffect(() => {
    if (open || hintReady) return;
    const show = setTimeout(() => setHintReady(true), HINT_IN_MS);
    return () => clearTimeout(show);
  }, [open, hintReady]);

  // ── 열려 있는 동안: Esc · 바깥 누르기로 닫기 ─────────────────────
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // pointerdown 이라야 링크를 누르기 '전' 에 닫히지 않는다 — 안쪽은 걸러 낸다.
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  // 열면 말풍선 안으로 초점을 옮긴다. 키보드·보이스오버로도 바로 읽히도록.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // 말이 늘어나면 늘 마지막 줄이 보이게 한다.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, typing, open]);

  useEffect(() => () => clearTimeout(timerRef.current ?? undefined), []);

  function ask(item: Ask) {
    if (typing) return;
    setAsked((prev) => [...prev, item.id]);
    setThread((prev) => [...prev, { role: 'me', text: item.chip }]);

    // 움직임을 줄이도록 설정한 사람에게는 점 세 개가 뛰는 것을 보여주지 않는다.
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    setTyping(true);
    timerRef.current = setTimeout(
      () => {
        setTyping(false);
        setThread((prev) => [...prev, { role: 'bot', text: item.answer, action: item.action }]);
      },
      reduce ? 0 : TYPING_MS,
    );
  }

  /**
   * 신청 자리로 굴러간다. behavior 를 넘기지 않는 것이 중요하다 —
   * 부드럽게 굴릴지 말지는 globals.css 의 scroll-behavior 가 이미 정하고 있고,
   * 그쪽은 '움직임 줄이기' 설정을 따른다. 여기서 넘기면 그 설정을 덮어쓴다.
   */
  function goTo(href: string) {
    const el = document.getElementById(href.replace(/^#/, ''));
    if (!el) return;
    close(false);
    el.scrollIntoView({ block: 'start' });
    // 화면을 읽어 주는 사람에게도 "도착했다" 가 전해져야 한다. 굴러가는 것은 이미 위에서 했다.
    el.focus({ preventScroll: true });
  }

  return (
    <div
      ref={rootRef}
      // 기둥(480px) 안에 붙는다. 바깥의 회색 여백으로 나가면 폰과 데스크톱에서 자리가 달라진다.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[480px] flex-col items-end px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
    >
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby="buddy-name"
          tabIndex={-1}
          className="buddy-panel glass-solid pointer-events-auto mb-3 flex max-h-[min(68vh,470px)] w-full max-w-[344px] flex-col overflow-hidden rounded-[24px] outline-none"
        >
          <div className="flex items-center gap-1.5 px-4 pb-1 pt-3.5">
            <Mascot mini />
            <p id="buddy-name" className="text-[12px] font-bold tracking-tight text-muted">
              {BUDDY.name}
            </p>
            <button
              type="button"
              onClick={() => close()}
              aria-label={BUDDY.closeLabel}
              className="-mr-1.5 ml-auto grid size-9 place-items-center rounded-full text-muted active:bg-foreground/10"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* 새로 올라온 말이 저절로 읽히게 한다. 목록 전체가 아니라 늘어난 줄만 읽힌다. */}
          <div
            ref={threadRef}
            aria-live="polite"
            className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {thread.map((line, i) =>
              line.role === 'me' ? (
                <p
                  key={i}
                  className="max-w-[86%] self-end whitespace-pre-line rounded-[18px] rounded-br-[7px] bg-brand px-3.5 py-2.5 text-[14px] font-semibold leading-[1.55] text-white"
                >
                  {line.text}
                </p>
              ) : (
                <div key={i} className="max-w-[92%] self-start">
                  <p className="glass-inset whitespace-pre-line rounded-[18px] rounded-bl-[7px] px-3.5 py-2.5 text-[14px] leading-[1.6]">
                    {line.text}
                  </p>
                  {line.action ? <Action action={line.action} onScroll={goTo} /> : null}
                </div>
              ),
            )}

            {typing ? (
              <p
                className="glass-inset flex w-fit gap-1 self-start rounded-[18px] rounded-bl-[7px] px-3.5 py-3.5"
                aria-label={BUDDY.typingLabel}
              >
                <i className="buddy-dot" />
                <i className="buddy-dot" />
                <i className="buddy-dot" />
              </p>
            ) : null}

            {finished && !typing ? (
              <p className="mt-1 px-1 text-[12px] leading-[1.6] text-muted">{BUDDY.done}</p>
            ) : null}
          </div>

          {/* 고를 수 있는 질문. 주고받은 말과 다른 옷을 입힌다 —
              흰 말풍선으로 두면 이미 오간 말인지 지금 누를 것인지 구별되지 않는다.
              내가 할 말이니 색은 내 말풍선과 같은 파랑을 쓰되, 아직 안 보냈으므로 테두리만 남긴다. */}
          {rest.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5 px-4 pb-4 pt-2">
              {rest.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => ask(item)}
                  disabled={typing}
                  className="min-h-11 rounded-full border border-brand/40 bg-background/60 px-3.5 text-[13px] font-bold text-brand active:bg-brand/10 disabled:opacity-40"
                >
                  {item.chip}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : hint ? (
        /* 마스코트 옆 한마디. 눌러도 열린다 — 말풍선만 보고 손을 뻗는 사람이 있다.
           버튼이 아니라 글이다. 초점을 받을 수 있는 것에 aria-hidden 을 걸면 화면 읽기 도구에게
           '없는데 갈 수는 있는' 자리가 된다. 옆의 마스코트 버튼이 같은 일을 이미 하고 있다. */
        <p
          onClick={() => setOpen(true)}
          aria-hidden
          className="buddy-hint glass pointer-events-auto mb-2.5 mr-1 cursor-pointer rounded-full rounded-br-[8px] px-3.5 py-2 text-[13px] font-bold"
        >
          {BUDDY.hint}
        </p>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setHintReady(false);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={open ? BUDDY.closeLabel : BUDDY.openLabel}
        className="buddy-trigger pointer-events-auto rounded-full p-1"
      >
        <Mascot open={open} />
      </button>
    </div>
  );
}

/**
 * 관찰이. 곰 한 마리를 SVG 로 그린다 — 그림 파일이 아니라서 배율마다 흐려지지 않고,
 * 눈을 깜빡이거나 말풍선이 열릴 때 웃는 눈으로 바꿀 수 있다.
 * 색·크기·움직임은 globals.css 의 `.buddy` 쪽에 있다.
 *   open  — 말풍선이 열려 있는 동안. 눈이 웃는 활로 바뀐다.
 *   mini  — 말풍선 머리에 붙는 작은 얼굴. 뜨지 않고 눈만 깜빡인다.
 */
function Mascot({ open = false, mini = false }: { open?: boolean; mini?: boolean }) {
  // 작은 얼굴과 큰 얼굴이 한 화면에 같이 뜬다. 그라데이션 id 가 겹치면 안 된다.
  const fur = `${useId()}-fur`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={['buddy', mini ? 'buddy-mini' : ''].join(' ').trim()}
      aria-hidden
    >
      <defs>
        <radialGradient id={fur} cx="34%" cy="20%" r="82%">
          <stop offset="0" stopColor="#fdefc6" />
          <stop offset="0.52" stopColor="#f4d488" />
          <stop offset="1" stopColor="#e3b264" />
        </radialGradient>
      </defs>

      {/* 귀 — 얼굴보다 먼저 그려서 뒤로 보낸다 */}
      <circle cx="15.5" cy="16" r="10" fill="#ecbd72" />
      <circle cx="48.5" cy="16" r="10" fill="#ecbd72" />
      <circle cx="15.5" cy="16.5" r="4.8" fill="#dda257" />
      <circle cx="48.5" cy="16.5" r="4.8" fill="#dda257" />

      <ellipse cx="32" cy="33" rx="23" ry="21.5" fill={`url(#${fur})`} />

      {open ? (
        <g stroke="#4a3418" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M19.5 31.5q4-5 8 0" />
          <path d="M36.5 31.5q4-5 8 0" />
        </g>
      ) : (
        <>
          <ellipse className="buddy-eye" cx="23.5" cy="30" rx="2.7" ry="3.5" fill="#4a3418" />
          <ellipse className="buddy-eye" cx="40.5" cy="30" rx="2.7" ry="3.5" fill="#4a3418" />
        </>
      )}

      {/* 주둥이 · 코 · 입 */}
      <ellipse cx="32" cy="40" rx="10" ry="7" fill="#fdf0cf" />
      <ellipse cx="32" cy="37" rx="3.4" ry="2.6" fill="#4a3418" />
      <path
        d="M32 39.4v2.3M32 41.7q-3 2.7-5.5.3M32 41.7q3 2.7 5.5.3"
        fill="none"
        stroke="#4a3418"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* 빨간 옷. 얼굴 뒤가 아니라 앞에 와서 턱을 덮는다.
          띠 하나로 두면 빨간 막대가 떠 있는 것처럼 보인다 — 어깨와 목선을 만들어야
          '옷을 입은 곰' 으로 읽힌다. 색은 사이트가 이미 쓰는 빨간펜 그대로다. */}
      <path className="buddy-coat" d="M5 64V57q0-7 8-9 5-1 9 1 4 5 10 5t10-5q4-2 9-1 8 2 8 9v7Z" />
      <path
        className="buddy-fold"
        d="M22 53q10 8 20 0"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 대답 아래 붙는 버튼. 바깥으로 나가는지 이 화면 안에서 움직이는지를 화살표로 구분한다. */
function Action({ action, onScroll }: { action: Ask['action']; onScroll: (href: string) => void }) {
  const inner = (
    <>
      {action.label}
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden>
        {action.kind === 'link' ? (
          <path
            d="M6 3h7v7M13 3L4 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M8 3v10M3.5 8.5L8 13l4.5-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </>
  );

  const style =
    'mt-1.5 flex min-h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-brand px-4 text-[14px] font-bold text-white shadow-[0_8px_20px_-8px_rgb(49_130_246/0.7)] active:bg-brand-pressed';

  if (action.kind === 'link') {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={style}
        /**
         * 이 페이지는 카카오톡으로 퍼진다. 그래서 대부분 카카오톡 안의 브라우저에서 열리는데,
         * 거기서는 새 창(target=_blank)이 막히는 경우가 있다 — 눌렀는데 아무 일도 안 일어나는
         * 것이 가장 나쁘다. 새 창이 막히면 이 화면에서 그대로 연다.
         * href·target 은 그대로 둔다. 자바스크립트가 죽어도, 길게 눌러 주소를 복사해도 된다.
         */
        onClick={(e) => {
          e.preventDefault();
          const opened = window.open(action.href, '_blank');
          if (opened) opened.opener = null;
          else window.location.href = action.href;
        }}
      >
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={() => onScroll(action.href)} className={style}>
      {inner}
    </button>
  );
}
