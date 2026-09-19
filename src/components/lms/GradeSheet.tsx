'use client';

import { useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GradingSaveState } from '@/app/lms/course-actions';
import {
  KINDS,
  PAPER,
  QUESTION_COUNT,
  SECTIONS,
  SECTION_LIST,
  paperQuestion,
  unitLabel,
} from '@/config/lms';
import { fmtScore } from '@/lib/format';
import { parseAnswerLine } from '@/lib/lms/answer-line';
import { gradingSnapshot } from '@/lib/lms/grading-snapshot';
import type { OmrReadResult, ReadAnswer } from '@/lib/lms/ocr-rows';
import { fillFromOmr, type Mark } from '@/lib/lms/omr-fill';
import { fmtAnswer, parseAnswer } from '@/lib/lms/paper';
import { scoreAttempt, type AnswerRow, type QuestionRow } from '@/lib/lms/score';
import { OmrReader } from './OmrReader';
import { RateBars, barsOf } from './RateBars';
import { btn, btnGhost, input, label } from './Shell';

/**
 * 채점 한 판. 채점은 선생님이 한다 — 이 표에 매겨 저장한 것이 곧 학생의 점수다.
 *
 * 매기는 길은 셋이다. OMR 사진을 올리면 마킹한 답을 읽어 칸을 채운다(OmrReader · omr-fill.ts).
 * 학생 답을 한 줄로 치거나 칸에 넣으면 정답과 맞춰 O/X 가 저절로 찍힌다. O/X 만 눌러도 된다.
 * 학생 답을 넣어 두면, 나중에 정답을 고쳤을 때 그 문항이 새 정답으로 다시 매겨진다.
 *
 * OMR 에서 애매하게 읽힌 문항은 칸을 비워 두고 노랗게 두른다. 읽힌 값은 옆에 붙여 '넣기' 로
 * 한 번에 넣게 한다 — 저절로 넣지는 않는다. 사람이 사진을 보고 누르게 한다.
 *
 * 합계는 저장하고 나서 보여주지 않고 찍는 즉시 위에서 움직인다 — 틀린 개수를 세다가
 * 잘못 눌렀다는 걸 그 자리에서 알아야 하기 때문이다. 그 계산은 서버가 쓰는 함수
 * (lib/lms/score.ts)를 그대로 부른다. 두 벌로 만들면 화면의 숫자와 저장된 숫자가 달라진다.
 *
 * 30문항을 다 매겨 저장하면 그때부터 학생 화면에 점수가 보인다. 따로 공개하는 단계는 없다.
 *
 * 저장은 화면을 그릴 때 본 판(정오와 정답표)이 지금도 같을 때만 된다 (grading-snapshot.ts).
 * 그사이 다른 창에서 이 학생의 채점을 저장했거나 정답표가 고쳐져 다시 매겨졌으면 DB 가 거절한다.
 * 그때는 화면을 넘기지 않고 바뀐 문항을 짚어 준다. 매긴 것은 그대로 남는다 — 새로 고쳐 바뀐
 * 채점을 볼지, 확인하고 이 화면의 채점으로 저장할지 튜터가 고른다.
 */

type Props = {
  action: (state: GradingSaveState, formData: FormData) => Promise<GradingSaveState>;
  /** OMR 사진을 읽어 초안을 돌려주는 서버 함수. 저장하지 않는다. */
  readOmr: (formData: FormData) => Promise<OmrReadResult>;
  omrConfigured: boolean;
  attemptId: string;
  questions: QuestionRow[];
  initialAnswers: AnswerRow[];
  initialOverall: string;
  /** 회차가 '학생에게 열림' 인가 — 다 매겨 저장한 점수가 학생에게 보이는지 말해 준다. */
  examOpen: boolean;
  /** 칸 코드(배점 · 단원) → 반 평균 정답률. 막대 옆 눈금으로 그린다. */
  classAverages: Record<string, number>;
};

/**
 * 채점표는 받은 값으로 칸을 한 번 채우고, 그 뒤로는 제가 쥔다 — 화면을 새로 고쳐도(router.refresh)
 * 매긴 것 · 총평 · 저장 결과가 그대로 남는다. 그래서 받은 판이 바뀌면 채점표를 새로 붙인다.
 *
 * 이게 없으면 정답표를 고쳐 O 가 X 로 다시 매겨진 뒤 '새로 고쳐 바뀐 채점 보기' 를 눌러도 옛 O 가
 * 남는다. 저장 결과에 든 판(거절될 때 받은 지금 판)도 남아서, 그대로 누르면 옛 점수가 검사를
 * 통과해 저장된다. 새로 붙이면 셋이 같이 새 판에서 시작한다.
 */
export function GradeSheet(props: Props) {
  const base = JSON.stringify(gradingSnapshot(props.questions, props.initialAnswers));
  return <Sheet key={base} {...props} initialBase={base} />;
}

function Sheet({
  action,
  readOmr,
  omrConfigured,
  attemptId,
  questions,
  initialAnswers,
  initialOverall,
  examOpen,
  classAverages,
  initialBase,
}: Props & { initialBase: string }) {
  const sorted = useMemo(() => [...questions].sort((a, b) => a.no - b.no), [questions]);
  const [marks, setMarks] = useState<Record<string, Mark>>(() =>
    Object.fromEntries(initialAnswers.map((a) => [a.question_id, a.correct ? 'o' : 'x'])),
  );
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialAnswers.filter((a) => a.chosen !== null).map((a) => [a.question_id, String(a.chosen)]),
    ),
  );
  // 문항 id → OMR 에서 애매하게 읽힌 값. 저장하지 않는다 — 이 화면에서 확인하는 데만 쓴다.
  const [hints, setHints] = useState<Record<string, ReadAnswer>>({});
  const [line, setLine] = useState('');
  const [lineNote, setLineNote] = useState<string | null>(null);
  const [saveState, save, saving] = useActionState(action, null);
  const router = useRouter();

  // 이 화면이 본 판. 저장이 거절되면 서버가 준 지금 판으로 바꿔 끼운다 — 튜터가 바뀐 문항을 확인하고
  // 한 번 더 누르면 그때는 이 화면의 채점으로 저장된다.
  const base = saveState?.base ?? initialBase;

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
    setChosen(nextChosen);
    setMarks(nextMarks);

    const notes = [`${values.size}문항을 넣었어요.`];
    if (invalid.size > 0) notes.push(`${[...invalid.keys()].join(', ')}번은 그 자리에 올 수 없는 값이라 매기지 않았어요.`);
    if (overflow > 0) notes.push(`${QUESTION_COUNT}번을 넘은 ${overflow}개는 버렸어요.`);
    setLineNote(notes.join(' '));
  }

  /** OMR 에서 읽은 답으로 칸을 채운다. 무엇을 채우고 무엇을 남겼는지 돌려준다. */
  function applyOmr(reads: ReadAnswer[]) {
    const next = fillFromOmr(sorted, reads, { chosen, marks });
    setChosen(next.chosen);
    setMarks(next.marks);
    setHints(next.hints);
    return next;
  }

  const pointBars = barsOf(score.byPoints, classAverages);
  const unitBars = barsOf(score.units, classAverages);

  return (
    <form action={save} className="flex flex-col gap-5">
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
            다른 창이나 다른 선생님이 이 학생의 채점을 먼저 저장했거나, 정답표가 고쳐져 다시 매겨졌을 수 있어요.
            화면에 남은 채점이 옛 정답으로 매긴 것이라면 새로 고쳐서 다시 보세요.
          </p>
          <p className="mt-1">
            지금 화면의 채점이 맞다면 아래 저장 단추를 한 번 더 누르세요. 그때는 이 화면의 채점으로 저장돼요.
          </p>
          <button
            type="button"
            onClick={() => {
              // 새 판이 오면 GradeSheet 가 채점표를 새로 붙인다 — 매긴 것과 견줄 판이 같이 버려진다.
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

      <OmrReader action={readOmr} attemptId={attemptId} configured={omrConfigured} onRead={applyOmr} />

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
                    onMark={(m) => setMarks((prev) => ({ ...prev, [q.id]: m }))}
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
          rows={5}
          placeholder="이번 회차 전체에 대해. 학생이 그대로 읽고, 답변 PDF 에도 들어가요."
          className="w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-[15px] leading-[1.7] outline-none focus:border-brand"
        />
      </div>

      {/* ── 저장. 다 매겨 저장하면 그대로 학생에게 보인다 — 매기다 만 점수는 안 보인다. */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btn} disabled={saving}>
          {saving ? '저장하는 중…' : '채점 저장'}
        </button>
        <p className="text-[13px] leading-[1.6] text-muted">
          {!score.complete
            ? `${score.count - score.graded}문항이 남았어요. 다 매겨 저장해야 학생에게 점수가 보여요.`
            : examOpen
              ? '다 매겼어요. 저장하면 학생 화면에 점수가 보여요.'
              : "다 매겼어요. 회차가 '준비 중' 이라 학생에게는 회차를 열어야 보여요."}
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
  onMark,
  onChosen,
}: {
  q: QuestionRow;
  mark: Mark;
  chosen: string;
  /** OMR 에서 애매하게 읽힌 값 */
  hint: ReadAnswer | undefined;
  onMark: (mark: Mark) => void;
  onChosen: (raw: string) => void;
}) {
  const paper = paperQuestion(q.no);
  const bad = chosen.trim() !== '' && parseAnswer(q.no, chosen) === null;

  // OMR 에서 확실히 못 읽은 문항. 아직 아무도 안 매겼으면 노랗게 두른다.
  const unsure = Boolean(hint && !hint.sure);
  const typed = parseAnswer(q.no, chosen);
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
          <span className="truncate">OMR {hint.answer !== null ? `${fmtAnswer(q.no, hint.answer)}?` : '확인'}</span>
          {hint.answer !== null && typed !== hint.answer ? (
            <button
              type="button"
              onClick={() => onChosen(String(hint.answer))}
              aria-label={`${q.no}번에 OMR 에서 읽힌 ${hint.answer} 넣기`}
              className="shrink-0 underline underline-offset-2"
            >
              넣기
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
