'use client';

import { useState, type FormEvent } from 'react';
import {
  KINDS,
  PAPER,
  QUESTION_COUNT,
  SECTIONS,
  SECTION_LIST,
  UNIT_GROUPS,
  type PaperQuestion,
} from '@/config/lms';
import { parseAnswerLine } from '@/lib/lms/answer-line';
import type { OcrResult, OcrRow } from '@/lib/lms/ocr-rows';
import { parseAnswer, unitsFor } from '@/lib/lms/paper';
import { AnswerKeyOcr } from './AnswerKeyOcr';
import { Card, btn, btnGhost, input } from './Shell';

/**
 * 정답표 편집.
 *
 * 시험지 모양이 정해져 있어서 번호 · 배점 · 5지선다/단답형은 고칠 칸이 아니다. 회차마다
 * 넣을 것은 정답 30개와, 원하면 단원뿐이다. 그래서 줄을 더하거나 지우는 단추가 없다.
 *
 * 칸 이름은 `answer_{번호}` · `unit_{번호}`. 번호가 곧 문항이라 줄이 밀릴 일이 없다.
 */

export type KeyRow = { no: number; answer: number | null; unit_code: string | null };

const CIRCLED = ['①', '②', '③', '④', '⑤'];

export function AnswerKeyEditor({
  action,
  ocrAction,
  ocrConfigured,
  examId,
  initial,
  flagged: flaggedFromServer = [],
}: {
  action: (formData: FormData) => Promise<void>;
  /** 사진에서 읽기. 결과는 칸에 채워 넣기만 하고 저장은 튜터가 누른다. */
  ocrAction: (formData: FormData) => Promise<OcrResult>;
  ocrConfigured: boolean;
  examId: string;
  initial: KeyRow[];
  /** 서버가 받지 않은 번호 (?nos=) */
  flagged?: number[];
}) {
  const byNo = new Map(initial.map((r) => [r.no, r]));
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(PAPER.map((q) => [q.no, byNo.get(q.no)?.answer?.toString() ?? ''])),
  );
  const [units, setUnits] = useState<Record<number, string>>(() =>
    Object.fromEntries(PAPER.map((q) => [q.no, byNo.get(q.no)?.unit_code ?? ''])),
  );
  /** 사진이나 한 줄 입력에서 온 칸. 옅게 칠해 눈으로 확인하게 한다. */
  const [touched, setTouched] = useState<Set<number>>(new Set());
  /** 한 줄 입력에서 번호가 밀린 것으로 보이는 칸. 고치면 풀린다. */
  const [flagged, setFlagged] = useState<Set<number>>(new Set(flaggedFromServer));
  const [line, setLine] = useState('');
  const [lineNote, setLineNote] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const invalid = PAPER.filter(
    (q) => flagged.has(q.no) || (answers[q.no].trim() !== '' && parseAnswer(q.no, answers[q.no]) === null),
  ).map((q) => q.no);
  const filled = PAPER.filter((q) => parseAnswer(q.no, answers[q.no]) !== null).length;
  const tagged = PAPER.filter((q) => units[q.no]).length;

  const setAnswer = (no: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [no]: value }));
    setFlagged((prev) => {
      if (!prev.has(no)) return prev;
      const next = new Set(prev);
      next.delete(no);
      return next;
    });
  };

  function applyOcr(rows: OcrRow[], mode: 'replace' | 'fill') {
    const nextAnswers = { ...answers };
    const nextUnits = { ...units };
    const marked = new Set<number>();
    for (const r of rows) {
      if (r.answer !== null && (mode === 'replace' || !answers[r.no].trim())) {
        nextAnswers[r.no] = String(r.answer);
        marked.add(r.no);
      }
      if (r.unit_code && (mode === 'replace' || !units[r.no])) {
        nextUnits[r.no] = r.unit_code;
        marked.add(r.no);
      }
    }
    setAnswers(nextAnswers);
    setUnits(nextUnits);
    setTouched(marked);
  }

  function applyLine() {
    const { values, invalid: bad, overflow } = parseAnswerLine(line);
    if (values.size === 0) {
      setLineNote('읽을 수 있는 답이 없어요. 띄어쓰기로 나눠 적어주세요.');
      return;
    }
    const nextAnswers = { ...answers };
    for (const [no, value] of values) nextAnswers[no] = bad.get(no) ?? (value === null ? '' : String(value));
    setAnswers(nextAnswers);
    setTouched(new Set(values.keys()));
    setFlagged(new Set(bad.keys()));

    const last = Math.max(...values.keys());
    const notes = [`1–${last}번을 채웠어요.`];
    if (last < QUESTION_COUNT) notes.push(`${last + 1}번부터는 비어 있어요.`);
    if (bad.size > 0) notes.push(`${[...bad.keys()].join(', ')}번은 그 자리에 올 수 없는 값이라 빨갛게 표시했어요 — 번호가 밀리지 않았는지 봐주세요.`);
    if (overflow > 0) notes.push(`${QUESTION_COUNT}번을 넘은 ${overflow}개는 버렸어요.`);
    setLineNote(notes.join(' '));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (invalid.length > 0) {
      event.preventDefault();
      setBlocked(true);
    }
  }

  return (
    <>
      <Card title="사진으로 채우기" className="mb-5">
        <AnswerKeyOcr action={ocrAction} examId={examId} onRows={applyOcr} configured={ocrConfigured} />
      </Card>

      <Card title="정답표">
        <form action={action} onSubmit={onSubmit}>
          <input type="hidden" name="exam_id" value={examId} />

          <div className="glass-inset mb-4 rounded-xl p-3">
            <label className="mb-1 block text-[12px] font-bold text-muted" htmlFor="answer-line">
              한 줄로 넣기
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="answer-line"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => {
                  // 이 칸에서 엔터는 폼 저장이 아니라 '칸에 채우기' 다.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLine();
                  }
                }}
                placeholder="3 5 2 4 1 … 12 7 24 … (5지선다는 35241 처럼 붙여 써도 돼요)"
                className={`${input} min-w-64 flex-1`}
                autoComplete="off"
                inputMode="numeric"
              />
              <button type="button" onClick={applyLine} className={btnGhost} disabled={!line.trim()}>
                칸에 채우기
              </button>
            </div>
            <p className="mt-1 text-[12px] leading-[1.6] text-muted">
              1번부터 순서대로 띄어 적어요. 모르는 칸은 <span className="font-bold">-</span> 로 자리만 채워요.
            </p>
            {lineNote ? <p className="mt-1 text-[12px] font-bold leading-[1.6]">{lineNote}</p> : null}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            <p className="text-muted">
              정답 <span className="font-bold text-foreground">{filled}</span>/{QUESTION_COUNT} · 단원{' '}
              <span className="font-bold text-foreground">{tagged}</span>/{QUESTION_COUNT}
            </p>
            {invalid.length > 0 ? (
              <p className="font-bold text-mark" role={blocked ? 'alert' : undefined}>
                {invalid.join(', ')}번 정답이 맞지 않아요. 5지선다는 1–5, 단답형은 0–999 예요.
              </p>
            ) : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {SECTION_LIST.map((section) => (
              <div key={section}>
                <h3 className="mb-2 text-[13px] font-extrabold text-muted">
                  {SECTIONS[section]}{' '}
                  <span className="font-bold">
                    {PAPER.filter((q) => q.section === section)[0].no}–
                    {PAPER.filter((q) => q.section === section).at(-1)!.no}번
                  </span>
                </h3>
                <div className="lms-scroll">
                  <table className="lms-table">
                    <thead>
                      <tr>
                        <th className="w-10">번호</th>
                        <th className="w-10 num">배점</th>
                        <th>정답</th>
                        <th>단원 (선택)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PAPER.filter((q) => q.section === section).map((q) => (
                        <KeyLine
                          key={q.no}
                          q={q}
                          answer={answers[q.no]}
                          unit={units[q.no]}
                          touched={touched.has(q.no)}
                          invalid={invalid.includes(q.no)}
                          onAnswer={(v) => setAnswer(q.no, v)}
                          onUnit={(v) => setUnits((prev) => ({ ...prev, [q.no]: v }))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" className={btn}>
              정답표 저장
            </button>
            {touched.size > 0 ? (
              <p className="text-[13px] font-bold text-mark">
                옅게 칠한 칸이 사진이나 한 줄 입력에서 온 값이에요. 저장하기 전에 눈으로 확인해주세요.
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            배점과 5지선다·단답형은 번호로 정해져 있어요. 정답을 고치면, 학생 답을 적어 두고 채점한
            문항은 새 정답으로 다시 매겨져요 — O/X 만 찍은 문항은 무엇을 골랐는지 몰라 그대로예요.
            단원은 비워도 점수에는 상관없고, 넣어 두면 단원별 정답률이 쌓여요.
          </p>
        </form>
      </Card>
    </>
  );
}

function KeyLine({
  q,
  answer,
  unit,
  touched,
  invalid,
  onAnswer,
  onUnit,
}: {
  q: PaperQuestion;
  answer: string;
  unit: string;
  touched: boolean;
  invalid: boolean;
  onAnswer: (value: string) => void;
  onUnit: (value: string) => void;
}) {
  return (
    <tr className={touched ? 'bg-mark-soft/40' : ''}>
      <td className="font-extrabold">{q.no}</td>
      <td className="num text-muted">{q.points}</td>
      <td>
        {q.kind === 'choice' ? (
          <div className="flex items-center gap-1" role="group" aria-label={`${q.no}번 정답`}>
            <input type="hidden" name={`answer_${q.no}`} value={answer} />
            {CIRCLED.map((mark, i) => {
              const value = String(i + 1);
              const on = answer.trim() === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${i + 1}번`}
                  // 같은 것을 다시 누르면 풀린다. 잘못 눌렀을 때 되돌릴 길이 있어야 한다.
                  onClick={() => onAnswer(on ? '' : value)}
                  className={`flex size-8 items-center justify-center rounded-lg text-[18px] font-bold leading-none ${
                    on ? 'bg-brand text-white' : 'bg-white/70 text-muted hover:text-foreground'
                  }`}
                >
                  {mark}
                </button>
              );
            })}
            {invalid ? <span className="ml-1 text-[12px] font-bold text-mark">{answer || '?'}</span> : null}
          </div>
        ) : (
          <input
            name={`answer_${q.no}`}
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            placeholder={KINDS.short}
            aria-label={`${q.no}번 정답`}
            aria-invalid={invalid}
            className={`${input} w-24 px-2 ${invalid ? 'border-mark text-mark' : ''}`}
          />
        )}
      </td>
      <td>
        <select
          name={`unit_${q.no}`}
          value={unit}
          onChange={(e) => onUnit(e.target.value)}
          aria-label={`${q.no}번 단원`}
          className={`${input} w-44`}
        >
          <option value="">—</option>
          {unitsFor(q.no).map((u) => (
            <option key={u.code} value={u.code}>
              {/* 미적분 칸은 과목이 하나뿐이라 과목 이름을 떼야 단원 이름이 안 잘린다. */}
              {q.section === 'common' ? `${UNIT_GROUPS[u.group]} · ${u.label}` : u.label}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
