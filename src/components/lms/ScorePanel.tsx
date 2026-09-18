import { SECTIONS, SECTION_LIST, paperQuestion } from '@/config/lms';
import { fmtRate, fmtScore } from '@/lib/format';
import { fmtAnswer } from '@/lib/lms/paper';
import type { AnswerRow, AttemptScore, QuestionRow } from '@/lib/lms/score';
import { RateBars, barsOf } from './RateBars';
import { Card, Stat } from './Shell';

/**
 * 한 회차의 점수 — 학생이 보는 화면. 튜터의 채점 화면과 같은 계산(lib/lms/score.ts)을 쓴다.
 * 정답 · 내 답 · 정오를 번호마다 나란히 둔다. 무엇을 골랐는지가 있어야 '왜' 를 이야기할 수 있다.
 */
export function ScorePanel({
  questions,
  answers,
  score,
  overallComment,
}: {
  questions: QuestionRow[];
  answers: AnswerRow[];
  score: AttemptScore;
  overallComment: string | null;
}) {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const unitBars = barsOf(score.units);
  const weakest = unitBars.find((b) => b.weak) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="점수" value={fmtScore(score.earned)} unit={`/ ${fmtScore(score.total)}점`} />
        {score.sections.map((s) => (
          <Stat key={s.code} label={s.label} value={fmtScore(s.earned)} unit={`/ ${fmtScore(s.total)}`} note={`${s.correct}/${s.count}문항`} />
        ))}
        <Stat
          label={weakest ? '가장 약한 단원' : '4점 문항'}
          value={weakest ? weakest.label : fmtRate(score.byPoints.find((p) => p.points === 4)?.rate ?? 0)}
          note={weakest ? `정답률 ${fmtRate(weakest.rate)}` : '정답률'}
        />
      </div>

      {overallComment ? (
        <Card title="선생님 총평">
          <p className="whitespace-pre-wrap text-[15px] leading-[1.8]">{overallComment}</p>
        </Card>
      ) : null}

      <Card title="문항별">
        <div className="flex flex-col gap-4">
          {SECTION_LIST.map((section) => (
            <div key={section}>
              <p className="mb-2 text-[12px] font-extrabold text-muted">{SECTIONS[section]}</p>
              <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 lg:grid-cols-11">
                {questions
                  .filter((q) => paperQuestion(q.no)?.section === section)
                  .map((q) => {
                    const a = byQuestion.get(q.id);
                    const wrong = a && !a.correct;
                    return (
                      <li
                        key={q.id}
                        className={`glass-inset flex flex-col items-center rounded-lg px-1 py-1.5 ${wrong ? 'ring-2 ring-mark/40' : ''}`}
                      >
                        <span className="text-[11px] font-bold text-muted">{q.no}</span>
                        <span className={`text-[16px] font-extrabold ${!a ? 'text-muted' : a.correct ? 'text-brand' : 'text-mark'}`}>
                          {!a ? '—' : a.correct ? 'O' : 'X'}
                        </span>
                        <span className="text-[10px] leading-tight text-muted">
                          {wrong ? `${fmtAnswer(q.no, a.chosen)} → ${fmtAnswer(q.no, q.answer)}` : fmtAnswer(q.no, q.answer)}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <p className="text-[12px] text-muted">
            칸 아래 숫자는 정답이에요. 틀린 칸은 &lsquo;내가 쓴 답 → 정답&rsquo; 이에요.
          </p>
        </div>
      </Card>

      <Card title="배점별 · 단원별">
        <div className="grid gap-5 md:grid-cols-2">
          <RateBars rows={barsOf(score.byPoints)} labelWidth="w-10" />
          {unitBars.length > 0 ? (
            <RateBars rows={unitBars} />
          ) : (
            <p className="text-[13px] leading-[1.6] text-muted">이 회차는 단원을 따로 매기지 않았어요.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
