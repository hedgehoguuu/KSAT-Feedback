'use client';

import { useMemo, useState } from 'react';
import {
  AREA_GROUPS,
  ELECTIVES,
  ELECTIVE_LIST,
  areaLabel,
  fmtRate,
  fmtScore,
  type Elective,
} from '@/config/lms';
import { questionsFor, scoreAttempt, type AnswerRow, type QuestionRow } from '@/lib/lms/score';
import { AreaBars, markWeak } from './AreaBars';
import { btn, btnGhost, input, label } from './Shell';

/**
 * 채점 한 판.
 *
 * 합계는 저장하고 나서 보여주지 않고 찍는 즉시 옆에서 움직인다 — 틀린 개수를
 * 세다가 잘못 눌렀다는 걸 그 자리에서 알아야 하기 때문이다.
 * 그 계산은 서버가 쓰는 함수(lib/lms/score.ts)를 그대로 부른다. 두 벌로 만들면
 * 언젠가 화면의 숫자와 저장된 숫자가 달라진다.
 */

type Mark = '' | 'o' | 'x';

export function GradeSheet({
  action,
  attemptId,
  questions,
  initialAnswers,
  initialElective,
  initialComments,
  initialOverall,
  initialStatus,
  studentElective,
  classAverages,
}: {
  action: (formData: FormData) => Promise<void>;
  attemptId: string;
  questions: QuestionRow[];
  initialAnswers: AnswerRow[];
  initialElective: Elective | null;
  initialComments: Record<string, string>;
  initialOverall: string;
  initialStatus: 'draft' | 'published';
  /** 학생 정보에 적힌 선택과목. 응시 기록에 아직 없을 때 기본값으로 쓴다. */
  studentElective: Elective | null;
  /** 영역 코드 → 반 평균 정답률. 막대 옆 눈금으로 그린다. */
  classAverages: Record<string, number>;
}) {
  const [elective, setElective] = useState<Elective | null>(initialElective ?? studentElective);
  const [marks, setMarks] = useState<Record<string, Mark>>(() => {
    const seed: Record<string, Mark> = {};
    for (const a of initialAnswers) seed[a.question_id] = a.correct ? 'o' : 'x';
    return seed;
  });
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const a of initialAnswers) if (a.chosen) seed[a.question_id] = String(a.chosen);
    return seed;
  });

  const mine = useMemo(() => questionsFor(questions, elective), [questions, elective]);

  const score = useMemo(() => {
    const answers: AnswerRow[] = mine
      .filter((q) => marks[q.id] === 'o' || marks[q.id] === 'x')
      .map((q) => ({
        question_id: q.id,
        correct: marks[q.id] === 'o',
        chosen: chosen[q.id] ? Number(chosen[q.id]) : null,
      }));
    return scoreAttempt(questions, answers, elective);
  }, [questions, mine, marks, chosen, elective]);

  const bars = markWeak(
    score.areas.map((a) => ({
      code: a.code,
      label: a.label,
      rate: a.rate,
      correct: a.correct,
      graded: a.graded,
      count: a.count,
      reference: classAverages[a.code] ?? null,
    })),
  );

  const setMark = (id: string, next: Mark) => setMarks((prev) => ({ ...prev, [id]: next }));

  /** 영역이 바뀌는 자리에 소제목을 넣기 위해, 문항을 영역 단위로 접어 둔다. */
  const sections = useMemo(() => {
    const out: { code: string; rows: QuestionRow[] }[] = [];
    for (const q of mine) {
      const last = out.at(-1);
      if (last && last.code === q.area_code) last.rows.push(q);
      else out.push({ code: q.area_code, rows: [q] });
    }
    return out;
  }, [mine]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="attempt_id" value={attemptId} />
      <input type="hidden" name="elective" value={elective ?? ''} />

      {/* ── 위에 붙어 따라다니는 합계. 스크롤을 내려도 지금 몇 점인지가 안 사라진다. */}
      <div className="glass-bar sticky top-14 z-10 -mx-1 flex flex-wrap items-center gap-4 rounded-xl px-4 py-3">
        <p className="text-[13px] font-bold text-muted">
          지금 점수{' '}
          <span className="ml-1 text-[22px] font-extrabold text-foreground">{fmtScore(score.earned)}</span>
          <span className="text-[13px] text-muted"> / {fmtScore(score.total)}</span>
        </p>
        <p className="text-[13px] text-muted">
          맞음 {score.correct} · 틀림 {score.graded - score.correct} · 안 매김{' '}
          <span className={score.graded < score.count ? 'font-bold text-mark' : ''}>
            {score.count - score.graded}
          </span>
        </p>
        {score.wrongNos.length > 0 ? (
          <p className="text-[13px] text-muted">틀린 문항 {score.wrongNos.join(', ')}</p>
        ) : null}
      </div>

      <div>
        <label className={label} htmlFor="elective-pick">선택과목</label>
        <select
          id="elective-pick"
          value={elective ?? ''}
          onChange={(e) => setElective((e.target.value || null) as Elective | null)}
          className={`${input} w-48`}
        >
          <option value="">고르지 않음 (공통만)</option>
          {ELECTIVE_LIST.map((e) => (
            <option key={e} value={e}>{ELECTIVES[e]}</option>
          ))}
        </select>
        <p className="mt-1 text-[12px] text-muted">
          고른 과목의 문항만 채점돼요. 이 회차에 응시한 과목을 골라주세요.
        </p>
      </div>

      {/* ── 문항 격자 */}
      <div className="flex flex-col gap-4">
        {sections.map((section, i) => (
          <div key={`${section.code}-${i}`}>
            <h3 className="mb-2 text-[13px] font-extrabold text-muted">
              {areaLabel(section.code)}
              <span className="ml-1 font-bold">{section.rows.length}문항</span>
            </h3>
            <ul className="flex flex-wrap gap-2">
              {section.rows.map((q) => {
                const mark = marks[q.id] ?? '';
                return (
                  <li
                    key={q.id}
                    className={`glass-inset flex w-[104px] flex-col gap-1 rounded-xl p-2 ${
                      mark === 'x' ? 'ring-2 ring-mark/40' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-[13px] font-extrabold">{q.no}</span>
                      <span className="text-[11px] text-muted">
                        {fmtScore(q.points)}점{q.answer ? ` · 답 ${q.answer}` : ''}
                      </span>
                    </div>

                    <div className="flex gap-1" role="group" aria-label={`${q.no}번 정오`}>
                      {(['o', 'x', ''] as Mark[]).map((v) => (
                        <label
                          key={v || 'none'}
                          className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-lg text-[13px] font-extrabold ${
                            mark === v
                              ? v === 'o'
                                ? 'bg-brand text-white'
                                : v === 'x'
                                  ? 'bg-mark text-white'
                                  : 'bg-white text-muted'
                              : 'bg-white/70 text-muted'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`mark_${q.id}`}
                            value={v}
                            checked={mark === v}
                            onChange={() => setMark(q.id, v)}
                            className="sr-only"
                          />
                          <span aria-label={v === 'o' ? '맞음' : v === 'x' ? '틀림' : '안 매김'}>
                            {v === 'o' ? 'O' : v === 'x' ? 'X' : '—'}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* 틀렸을 때만 물어본다. 맞은 문항의 고른 번호는 정답과 같아서 볼 일이 없다. */}
                    {mark === 'x' ? (
                      <select
                        name={`chosen_${q.id}`}
                        value={chosen[q.id] ?? ''}
                        onChange={(e) => setChosen((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        className="min-h-8 rounded-lg border border-line bg-white px-1 text-[12px] outline-none focus:border-brand"
                        aria-label={`${q.no}번에 고른 번호`}
                      >
                        <option value="">고른 답 —</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}번을 고름</option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {sections.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-muted">
            이 회차에 문항표가 아직 없어요. 문항표부터 만들어 주세요.
          </p>
        ) : null}
      </div>

      {/* ── 영역별 결과와 코멘트 */}
      <div className="glass-inset rounded-2xl p-4">
        <h3 className="mb-3 text-[14px] font-extrabold">영역별</h3>
        <AreaBars rows={bars} />

        <div className="mt-5 flex flex-col gap-3">
          {score.groups.map((group) => (
            <div key={group.group}>
              <p className="mb-2 text-[12px] font-extrabold text-muted">
                {AREA_GROUPS[group.group]} · {group.correct}/{group.graded || group.count} ·{' '}
                {fmtRate(group.rate)}
              </p>
              <div className="flex flex-col gap-2">
                {group.areas.map((area) => (
                  <div key={area.code}>
                    <label className={label} htmlFor={`comment_${area.code}`}>
                      {area.label} 코멘트
                    </label>
                    <textarea
                      id={`comment_${area.code}`}
                      name={`comment_${area.code}`}
                      defaultValue={initialComments[area.code] ?? ''}
                      rows={2}
                      placeholder={`${area.label}에서 무엇이 무너졌는지 한두 줄로`}
                      className="w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-[14px] leading-[1.6] outline-none focus:border-brand"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="overall_comment">총평</label>
        <textarea
          id="overall_comment"
          name="overall_comment"
          defaultValue={initialOverall}
          rows={5}
          placeholder="이번 회차 전체에 대해. 학생이 그대로 읽어요."
          className="w-full rounded-xl border border-line bg-white/70 px-3 py-2 text-[15px] leading-[1.7] outline-none focus:border-brand"
        />
      </div>

      {/* ── 저장. 공개는 따로 눌러야 한다 — 매기다 만 점수가 학생에게 보이면 안 된다. */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="status" value="draft" className={btnGhost}>
          저장만 하기
        </button>
        <button type="submit" name="status" value="published" className={btn}>
          저장하고 학생에게 공개
        </button>
        <p className="text-[13px] text-muted">
          {initialStatus === 'published' ? '지금 학생에게 보이는 상태예요' : '아직 학생에게 안 보여요'}
        </p>
      </div>
    </form>
  );
}
