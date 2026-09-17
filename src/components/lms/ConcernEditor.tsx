'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AutoTextarea } from '@/components/AutoTextarea';
import { CONCERN, PAPER, concernOrder, concernTopic } from '@/config/lms';
import { btn, btnGhost } from './Shell';

/**
 * 학생이 문항마다 고민을 적는 칸.
 *
 * 한 줄에 한 문항. 번호를 고르고 무엇이 막혔는지 적는다. 같은 번호는 두 번 고를 수 없다 —
 * 한 문항의 이야기가 두 줄로 흩어지면 답도 둘로 흩어진다. '시험 전체' 자리가 따로 있다.
 *
 * 선생님이 이미 답을 단 질문은 고칠 수 없다(DB 도 막는다). 질문이 바뀌면 달아 둔 답이
 * 엉뚱한 말이 된다. 그래서 그 줄은 읽기만 되게 보여 준다.
 *
 * 칸 이름은 `topic` · `body` 를 반복한다. FormData 가 문서 순서를 지켜 짝이 안 어긋난다.
 */

export type ConcernSeed = { question_no: number; body: string; answered: boolean };

type Line = { key: string; topic: string; body: string; answered: boolean };

let seq = 0;
const nextKey = () => `c${Date.now()}-${seq++}`;

const EXAMPLES = [
  '21번 — 그래프 개형을 떠올리지 못해서 식만 붙잡고 10분을 썼어요',
  '시험 전체 — 15번에서 막히니까 뒤 문제까지 급해졌어요',
];

export function ConcernEditor({
  examId,
  action,
  initial,
  submitted,
  photoCount,
  wrongNos,
}: {
  examId: string;
  action: (form: FormData) => Promise<void>;
  initial: ConcernSeed[];
  submitted: boolean;
  photoCount: number;
  /** 채점이 공개됐으면 틀린 번호를 먼저 권한다 */
  wrongNos: number[];
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    initial.length > 0
      ? [...initial]
          .sort((a, b) => concernOrder(a.question_no, b.question_no))
          .map((c) => ({ key: nextKey(), topic: String(c.question_no), body: c.body, answered: c.answered }))
      : [{ key: nextKey(), topic: '', body: '', answered: false }],
  );
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // 적다가 창을 닫으면 사라진다. 저장 전이면 한 번 묻는다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const used = new Set(lines.map((l) => l.topic).filter(Boolean));
  const change = (key: string, next: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));
    setDirty(true);
    setProblem(null);
  };
  const add = (topic = '') => {
    setLines((prev) => [...prev, { key: nextKey(), topic, body: '', answered: false }]);
    setDirty(true);
  };
  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setDirty(true);
  };

  const written = lines.filter((l) => !l.answered && l.body.trim());
  const suggest = wrongNos.filter((no) => !used.has(String(no))).slice(0, 6);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value;

    const orphan = lines.find((l) => !l.answered && l.body.trim() && !l.topic);
    if (orphan) {
      event.preventDefault();
      setProblem('번호를 고르지 않은 질문이 있어요. 어느 문항인지 골라주세요.');
      return;
    }
    if (intent === 'submit' && written.length === 0 && !lines.some((l) => l.answered)) {
      event.preventDefault();
      setProblem('질문을 하나 이상 적어주세요.');
      return;
    }
    if (intent === 'submit' && !submitted && photoCount === 0) {
      if (!window.confirm('시험지 사진 없이 제출할까요?\n\n선생님이 풀이 흔적을 보고 답을 달아요. 사진을 먼저 올리는 게 좋아요.')) {
        event.preventDefault();
        return;
      }
    }
    setDirty(false);
  }

  return (
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="exam_id" value={examId} />

      {suggest.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">틀린 문항부터 적어 볼까요?</span>
          {suggest.map((no) => (
            <button
              key={no}
              type="button"
              onClick={() => add(String(no))}
              className="rounded-lg bg-mark-soft px-2.5 py-1 font-bold text-mark"
            >
              {no}번 더하기
            </button>
          ))}
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {lines.map((line, i) =>
          line.answered ? (
            <li key={line.key} className="glass-inset rounded-xl p-3">
              <p className="text-[13px] font-extrabold">
                {concernTopic(Number(line.topic))}
                <span className="ml-2 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-bold text-brand">
                  선생님이 답을 달았어요
                </span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.7]">{line.body}</p>
              <p className="mt-1 text-[12px] text-muted">답을 단 질문은 고칠 수 없어요.</p>
            </li>
          ) : (
            <li key={line.key} className="glass-inset flex flex-col gap-2 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <select
                  name="topic"
                  value={line.topic}
                  onChange={(e) => change(line.key, { topic: e.target.value })}
                  aria-label={`${i + 1}번째 질문의 문항`}
                  className="min-h-10 rounded-xl border border-line bg-white/80 px-3 text-[15px] font-bold outline-none focus:border-brand"
                >
                  <option value="">문항 고르기</option>
                  {PAPER.map((q) => (
                    <option key={q.no} value={q.no} disabled={used.has(String(q.no)) && line.topic !== String(q.no)}>
                      {q.no}번
                    </option>
                  ))}
                  <option value={CONCERN.wholeExam} disabled={used.has('0') && line.topic !== '0'}>
                    {concernTopic(CONCERN.wholeExam)}
                  </option>
                </select>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="min-h-10 px-2 text-[13px] font-semibold text-muted hover:text-danger"
                >
                  지우기
                </button>
              </div>
              <AutoTextarea
                name="body"
                value={line.body}
                maxLength={CONCERN.maxBody}
                onChange={(v) => change(line.key, { body: v })}
                aria-label={`${i + 1}번째 질문`}
                placeholder={
                  i < EXAMPLES.length
                    ? `예) ${EXAMPLES[i]}`
                    : '어디서 막혔는지, 무엇을 떠올리지 못했는지 적어주세요'
                }
              />
              {line.body.length > CONCERN.maxBody * 0.9 ? (
                <p className="text-right text-[12px] text-muted">
                  {line.body.length} / {CONCERN.maxBody}자
                </p>
              ) : null}
            </li>
          ),
        )}
      </ul>

      <div>
        <button type="button" onClick={() => add()} className={btnGhost}>
          질문 더하기
        </button>
      </div>

      {problem ? (
        <p className="rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="submit" className={btn}>
          {submitted ? '고친 내용 저장' : '제출하기'}
        </button>
        {!submitted ? (
          <button type="submit" name="intent" value="save" className={btnGhost}>
            임시 저장
          </button>
        ) : null}
        <p className="text-[13px] text-muted">
          {submitted
            ? '제출했어요. 선생님이 답을 보내기 전까지는 고칠 수 있어요.'
            : '제출해야 선생님이 답을 달 차례가 돼요.'}
        </p>
      </div>
    </form>
  );
}
