'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KINDS,
  PAPER,
  QUESTION_COUNT,
  SECTIONS,
  SECTION_LIST,
  fmtAnswer,
  fmtScore,
  paperQuestion,
  parseAnswer,
  unitLabel,
} from '@/config/lms';
import type { GradingSaveState } from '@/app/lms/course-actions';
import { parseAnswerLine } from '@/lib/lms/answer-line';
import { gradingSnapshot } from '@/lib/lms/grading-snapshot';
import type { ReadAnswer } from '@/lib/lms/ocr-rows';
import { scoreAttempt, type AnswerRow, type QuestionRow } from '@/lib/lms/score';
import { setDirty } from './dirty';
import { RateBars, barsOf } from './RateBars';
import { btn, btnGhost, input, label } from './Shell';

/**
 * 채점 한 판.
 *
 * 학생이 쓴 답을 넣으면 정답과 맞춰 O/X 가 저절로 찍힌다. 답을 안 넣고 O/X 만 눌러도 된다 —
 * 수업 중에 시험지를 넘기며 빠르게 매길 때는 그쪽이 빠르다. 다만 학생 답을 넣어 두면,
 * 나중에 정답을 고쳤을 때 그 문항이 새 정답으로 다시 매겨진다.
 *
 * 합계는 저장하고 나서 보여주지 않고 찍는 즉시 위에서 움직인다 — 틀린 개수를 세다가
 * 잘못 눌렀다는 걸 그 자리에서 알아야 하기 때문이다. 그 계산은 서버가 쓰는 함수
 * (lib/lms/score.ts)를 그대로 부른다. 두 벌로 만들면 화면의 숫자와 저장된 숫자가 달라진다.
 *
 * 사진에서 읽은 답(hints)이 있으면 칸마다 붙인다. 확실히 못 읽은 문항은 노랗게 두르고
 * 읽힌 값을 '넣기' 로 한 번에 넣게 한다 — 저절로 넣지는 않는다. 사람이 사진을 보고 누르게 한다.
 *
 * 저장은 화면을 그릴 때 본 판(정오와 정답표)이 지금도 같을 때만 된다 (grading-snapshot.ts).
 * 그사이 학생이 사진을 바꿔 사진 채점이 비워졌거나 새로 채워졌거나, 정답표가 고쳐졌으면 DB 가
 * 거절한다. 그때는 화면을 넘기지 않고 바뀐 문항을 짚어 준다. 매긴 것은 그대로 남는다 —
 * 새로 고쳐 바뀐 채점을 볼지, 확인하고 이 화면의 채점으로 저장할지 튜터가 고른다.
 * 학생이 질문을 제출하는 것처럼 채점과 상관없는 일로는 거절되지 않는다.
 */

type Mark = '' | 'o' | 'x';

export function GradeSheet({
  action,
  attemptId,
  questions,
  initialAnswers,
  initialOverall,
  initialStatus,
  classAverages,
  hints = {},
  tutorOwned = false,
}: {
  action: (state: GradingSaveState, formData: FormData) => Promise<GradingSaveState>;
  attemptId: string;
  questions: QuestionRow[];
  initialAnswers: AnswerRow[];
  initialOverall: string;
  initialStatus: 'draft' | 'published';
  /** 칸 코드(배점 · 단원) → 반 평균 정답률. 막대 옆 눈금으로 그린다. */
  classAverages: Record<string, number>;
  /** 문항 id → 사진에서 읽은 답 */
  hints?: Record<string, ReadAnswer>;
  /** 지금 채점을 튜터가 직접 매겼다. 사진과 다른 칸에 읽힌 값을 옅게 적어 준다. */
  tutorOwned?: boolean;
}) {
  const sorted = useMemo(() => [...questions].sort((a, b) => a.no - b.no), [questions]);
  const [marks, setMarks] = useState<Record<string, Mark>>(() =>
    Object.fromEntries(initialAnswers.map((a) => [a.question_id, a.correct ? 'o' : 'x'])),
  );
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialAnswers.filter((a) => a.chosen !== null).map((a) => [a.question_id, String(a.chosen)]),
    ),
  );
  const [line, setLine] = useState('');
  const [lineNote, setLineNote] = useState<string | null>(null);
  const [saveState, save, saving] = useActionState(action, null);
  const router = useRouter();

  // 이 화면이 본 판. 저장이 거절되면 서버가 준 지금 판으로 바꿔 끼운다 — 튜터가 바뀐 문항을 확인하고
  // 한 번 더 누르면 그때는 이 화면의 채점으로 저장된다.
  const initialBase = useMemo(
    () => JSON.stringify(gradingSnapshot(questions, initialAnswers)),
    [questions, initialAnswers],
  );
  const base = saveState?.base ?? initialBase;

  // 이 화면을 떠나면 '저장 안 한 손질' 도 함께 사라진다.
  useEffect(() => () => setDirty(false), []);

  // 저장이 거절되면 매긴 것이 화면에만 남는다. 다시 '저장 안 한 손질' 로 표시해 둬야
  // 사진 읽기 감시가 화면을 새로 고쳐 날리지 않는다.
  useEffect(() => {
    if (saveState?.stale) setDirty(true);
  }, [saveState]);

  const score = useMemo(() => {
    const answers: AnswerRow[] = sorted
      .filter((q) => marks[q.id] === 'o' || marks[q.id] === 'x')
      .map((q) => ({
        question_id: q.id,
        correct: marks[q.id] === 'o',
        chosen: parseAnswer(q.no, chosen[q.id]),
      }));
    return scoreAttempt(sorted, answers);
  }, [sorted, marks, chosen]);

  const missingKey = sorted.filter((q) => q.answer === null).map((q) => q.no);

  /** 학생 답을 적으면 정답과 맞춰 본다. 정답이 없거나 답이 맞지 않는 값이면 O/X 는 그대로 둔다. */
  function writeAnswer(q: QuestionRow, raw: string) {
    setDirty(true);
    setChosen((prev) => ({ ...prev, [q.id]: raw }));
    const value = parseAnswer(q.no, raw);
    if (value !== null && q.answer !== null) {
      setMarks((prev) => ({ ...prev, [q.id]: value === q.answer ? 'o' : 'x' }));
    }
  }

  function applyLine() {
    const { values, invalid, overflow } = parseAnswerLine(line);
    if (values.size === 0) {
      setLineNote('읽을 수 있는 답이 없어요. 띄어쓰기로 나눠 적어주세요.');
      return;
    }
    const nextChosen = { ...chosen };
    const nextMarks = { ...marks };
    for (const q of sorted) {
      if (!values.has(q.no)) continue;
      const value = values.get(q.no) ?? null;
      nextChosen[q.id] = invalid.get(q.no) ?? (value === null ? '' : String(value));
      if (invalid.has(q.no) || q.answer === null) continue;
      // '-' 로 비운 칸은 학생이 안 쓴 답이다 — 틀린 것으로 매긴다.
      nextMarks[q.id] = value !== null && value === q.answer ? 'o' : 'x';
    }
    setDirty(true);
    setChosen(nextChosen);
    setMarks(nextMarks);

    const notes = [`${values.size}문항을 넣었어요.`];
    if (invalid.size > 0) notes.push(`${[...invalid.keys()].join(', ')}번은 그 자리에 올 수 없는 값이라 매기지 않았어요.`);
    if (overflow > 0) notes.push(`${QUESTION_COUNT}번을 넘은 ${overflow}개는 버렸어요.`);
    setLineNote(notes.join(' '));
  }

  const pointBars = barsOf(score.byPoints, classAverages);
  const unitBars = barsOf(score.units, classAverages);

  return (
    <form action={save} onSubmit={() => setDirty(false)} className="flex flex-col gap-5">
      <input type="hidden" name="attempt_id" value={attemptId} />
      <input type="hidden" name="base" value={base} />

      {/* ── 위에 붙어 따라다니는 합계. 스크롤을 내려도 지금 몇 점인지가 안 사라진다. */}
      <div className="glass-bar sticky top-14 z-10 -mx-1 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl px-4 py-3">
        <p className="text-[13px] font-bold text-muted">
          지금 점수{' '}
          <span className="ml-1 text-[22px] font-extrabold text-foreground">{fmtScore(score.earned)}</span>
          <span className="text-[13px] text-muted"> / {fmtScore(score.total)}</span>
        </p>
        {score.sections.map((s) => (
          <p key={s.code} className="text-[13px] text-muted">
            {s.label} <span className="font-bold text-foreground">{fmtScore(s.earned)}</span>/{fmtScore(s.total)}
          </p>
        ))}
        <p className="text-[13px] text-muted">
          맞음 {score.correct} · 틀림 {score.graded - score.correct} · 안 매김{' '}
          <span className={score.graded < score.count ? 'font-bold text-mark' : ''}>{score.count - score.graded}</span>
        </p>
        {score.wrongNos.length > 0 ? (
          <p className="text-[13px] font-bold text-mark">틀린 문항 {score.wrongNos.join(', ')}</p>
        ) : null}
      </div>

      {saveState?.stale ? (
        <div className="rounded-xl bg-mark-soft px-4 py-3 text-[14px] leading-[1.7] text-mark" role="alert">
          <p className="font-bold">
            저장하지 않았어요 — 이 화면을 연 뒤에 이 학생의 채점이 바뀌었어요
            {saveState.changed.length > 0 ? ` (${saveState.changed.join(', ')}번)` : ''}.
          </p>
          <p>
            학생이 시험지 사진을 바꿔 사진으로 매긴 채점이 비워졌거나 새로 채워졌을 수 있고, 정답표가 고쳐졌을 수도
            있어요. 화면에 남은 채점이 옛 사진이나 옛 정답으로 매긴 것이라면 새로 고쳐서 다시 보세요.
          </p>
          <p className="mt-1">
            지금 화면의 채점이 맞다면 아래 저장 단추를 한 번 더 누르세요. 그때는 이 화면의 채점으로 저장돼요.
          </p>
          <button
            type="button"
            onClick={() => {
              setDirty(false);
              router.refresh();
            }}
            className="mt-2 underline underline-offset-2 font-bold"
          >
            새로 고쳐 바뀐 채점 보기 (지금 매긴 것은 사라져요)
          </button>
        </div>
      ) : null}

      {missingKey.length > 0 ? (
        <p className="rounded-xl bg-mark-soft px-4 py-3 text-[13px] font-bold leading-[1.6] text-mark">
          정답이 비어 있는 번호가 있어요 ({missingKey.join(', ')}). 그 문항은 학생 답을 넣어도 저절로 매겨지지 않으니
          O/X 를 직접 눌러주세요.
        </p>
      ) : null}

      <div className="glass-inset rounded-xl p-3">
        <label className={label} htmlFor="student-line">
          학생 답 한 줄로 넣기
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="student-line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              // 이 칸에서 엔터는 저장이 아니라 '넣기' 다.
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLine();
              }
            }}
            placeholder="3 5 2 4 1 … 12 7 - 24 … (안 쓴 답은 -)"
            className={`${input} min-w-64 flex-1`}
            autoComplete="off"
            inputMode="numeric"
          />
          <button type="button" onClick={applyLine} className={btnGhost} disabled={!line.trim()}>
            넣고 매기기
          </button>
        </div>
        {lineNote ? <p className="mt-1 text-[12px] font-bold leading-[1.6]">{lineNote}</p> : null}
      </div>

      {/* ── 문항 격자 */}
      <div className="flex flex-col gap-4">
        {SECTION_LIST.map((section) => {
          const rows = sorted.filter((q) => paperQuestion(q.no)?.section === section);
          if (rows.length === 0) return null;
          return (
            <div key={section}>
              <h3 className="mb-2 text-[13px] font-extrabold text-muted">
                {SECTIONS[section]} <span className="font-bold">{rows.length}문항</span>
              </h3>
              <ul className="flex flex-wrap gap-2">
                {rows.map((q) => (
                  <Cell
                    key={q.id}
                    q={q}
                    mark={marks[q.id] ?? ''}
                    chosen={chosen[q.id] ?? ''}
                    hint={hints[q.id]}
                    tutorOwned={tutorOwned}
                    onMark={(m) => {
                      setDirty(true);
                      setMarks((prev) => ({ ...prev, [q.id]: m }));
                    }}
                    onChosen={(raw) => writeAnswer(q, raw)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        {sorted.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-muted">
            이 회차에 문항표가 아직 없어요. 정답표 화면을 한 번 저장해 주세요.
          </p>
        ) : null}
        {sorted.length > 0 && sorted.length < PAPER.length ? (
          <p className="text-[13px] font-bold text-mark">
            문항표가 {sorted.length}줄뿐이에요. 정답표 화면에서 저장하면 1–{QUESTION_COUNT}번이 다 깔려요.
          </p>
        ) : null}
      </div>

      {/* ── 배점별 · 단원별 */}
      <div className="glass-inset grid gap-5 rounded-2xl p-4 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-[14px] font-extrabold">배점별</h3>
          <RateBars rows={pointBars} labelWidth="w-10" />
        </div>
        <div>
          <h3 className="mb-3 text-[14px] font-extrabold">단원별</h3>
          {unitBars.length > 0 ? (
            <RateBars rows={unitBars} />
          ) : (
            <p className="text-[13px] leading-[1.6] text-muted">
              정답표에 단원을 넣으면 여기에 단원별 정답률이 나와요.
            </p>
          )}
          {unitBars.length > 0 && score.untagged > 0 ? (
            <p className="mt-2 text-[12px] text-muted">단원을 안 넣은 {score.untagged}문항은 여기서 빠졌어요.</p>
          ) : null}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="overall_comment">총평</label>
        <textarea
          id="overall_comment"
          name="overall_comment"
          defaultValue={initialOverall}
          onChange={() => setDirty(true)}
          rows={5}
          placeholder="이번 회차 전체에 대해. 학생이 그대로 읽고, 답변 PDF 에도 들어가요."
          className="w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-[15px] leading-[1.7] outline-none focus:border-brand"
        />
      </div>

      {/* ── 저장. 공개는 따로 눌러야 한다 — 매기다 만 점수가 학생에게 보이면 안 된다. */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="status" value="draft" className={btnGhost} disabled={saving}>
          저장만 하기
        </button>
        <button type="submit" name="status" value="published" className={btn} disabled={saving}>
          저장하고 점수 공개
        </button>
        <p className="text-[13px] text-muted">
          {initialStatus === 'published' ? '지금 학생에게 점수가 보이는 상태예요' : '아직 학생에게 점수가 안 보여요'}
        </p>
      </div>
    </form>
  );
}

function Cell({
  q,
  mark,
  chosen,
  hint,
  tutorOwned,
  onMark,
  onChosen,
}: {
  q: QuestionRow;
  mark: Mark;
  chosen: string;
  hint: ReadAnswer | undefined;
  tutorOwned: boolean;
  onMark: (mark: Mark) => void;
  onChosen: (raw: string) => void;
}) {
  const paper = paperQuestion(q.no);
  const bad = chosen.trim() !== '' && parseAnswer(q.no, chosen) === null;

  // 사진에서 확실히 못 읽은 문항. 아직 아무도 안 매겼으면 노랗게 두른다.
  const unsure = Boolean(hint && !hint.sure);
  const typed = parseAnswer(q.no, chosen);
  // 튜터가 직접 매긴 채점에서 사진과 다른 칸
  const differs =
    Boolean(hint?.sure) && tutorOwned && (hint!.answer === null ? typed !== null : typed !== null && typed !== hint!.answer);
  const ring = mark === 'x' ? 'ring-2 ring-mark/40' : unsure && mark === '' ? 'ring-2 ring-check/60' : '';

  return (
    <li
      className={`glass-inset flex w-[124px] flex-col gap-1.5 rounded-xl p-2 ${ring}`}
      title={q.unit_code ? unitLabel(q.unit_code) : undefined}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-extrabold">{q.no}</span>
        <span className="text-[11px] text-muted">
          {fmtScore(q.points)}점 · 답{' '}
          {/* 동그라미 숫자는 작은 글씨에서 뭉개진다. 정답만 한 치수 키운다. */}
          <span className="text-[14px] font-extrabold leading-none text-foreground">{fmtAnswer(q.no, q.answer)}</span>
        </span>
      </div>

      <input type="hidden" name={`mark_${q.id}`} value={mark} />
      <input
        name={`chosen_${q.id}`}
        value={chosen}
        onChange={(e) => onChosen(e.target.value)}
        inputMode="numeric"
        maxLength={4}
        placeholder={paper?.kind === 'short' ? `학생 답 (${KINDS.short})` : '학생 답 (1–5)'}
        aria-label={`${q.no}번 학생 답`}
        aria-invalid={bad}
        className={`min-h-8 w-full rounded-lg border bg-white px-2 text-[13px] outline-none focus:border-brand ${
          bad ? 'border-mark text-mark' : 'border-line'
        }`}
      />

      <div className="flex gap-1" role="group" aria-label={`${q.no}번 정오`}>
        {(['o', 'x', ''] as Mark[]).map((v) => (
          <button
            key={v || 'none'}
            type="button"
            aria-pressed={mark === v}
            aria-label={v === 'o' ? '맞음' : v === 'x' ? '틀림' : '안 매김'}
            onClick={() => onMark(v)}
            className={`flex h-8 flex-1 items-center justify-center rounded-lg text-[13px] font-extrabold ${
              mark === v
                ? v === 'o'
                  ? 'bg-brand text-white'
                  : v === 'x'
                    ? 'bg-mark text-white'
                    : 'bg-white text-muted'
                : 'bg-white/70 text-muted'
            }`}
          >
            <span aria-hidden>{v === 'o' ? 'O' : v === 'x' ? 'X' : '—'}</span>
          </button>
        ))}
      </div>

      {unsure && hint ? (
        <div
          className="flex min-h-6 items-center justify-between gap-1 rounded-md bg-check-soft px-1.5 text-[11px] font-bold text-check"
          title={hint.note ?? undefined}
        >
          <span className="truncate">사진 {hint.answer !== null ? `${fmtAnswer(q.no, hint.answer)}?` : '확인'}</span>
          {hint.answer !== null && typed !== hint.answer ? (
            <button
              type="button"
              onClick={() => onChosen(String(hint.answer))}
              aria-label={`${q.no}번에 사진에서 읽힌 ${hint.answer} 넣기`}
              className="shrink-0 underline underline-offset-2"
            >
              넣기
            </button>
          ) : null}
        </div>
      ) : differs && hint ? (
        <p className="text-[11px] text-muted" title="사진에서 읽힌 답">
          사진 {hint.answer === null ? '빈칸' : fmtAnswer(q.no, hint.answer)}
        </p>
      ) : null}
    </li>
  );
}
