'use client';

import { useState } from 'react';
import { Marked } from '@/components/Marked';
import { COPY } from '@/config/class-copy';

type Answers = Record<string, string>;

/**
 * 자가진단 (모집 페이지 §②).
 *
 * 접수 화면에서 학생에게 실제로 물었던 문항을 그대로 쓴다. 우리가 "당신은 이렇다"고
 * 말하는 것보다, 학생이 세 번 눌러 스스로 도달하는 편이 훨씬 세다.
 *
 * 네 번째 결과는 *이 수업을 권하지 않는다* 고 말한다. 그게 나머지 셋을 믿게 만든다 —
 * 무엇을 눌러도 "당신에게 필요하다"고 답하는 진단은 아무도 믿지 않는다.
 */
function diagnose(a: Answers): keyof typeof COPY.checkResults | null {
  const { time, area, after } = a;
  if (!time || !area || !after) return null;

  // 다시 봐도 모르겠다면 시간 문제가 아니다. 다른 답과 상관없이 여기로 보낸다.
  if (after === '다시 봐도 모르겠어요') return 'basics';
  if (time === '못 푼 지문이 있어요' || time === '조금 부족했어요') return 'time';
  if (area === '독서') return 'over';
  return 'pick';
}

export function SelfCheck() {
  const [answers, setAnswers] = useState<Answers>({});
  const key = diagnose(answers);
  const result = key ? COPY.checkResults[key] : null;

  return (
    <div>
      <div className="mt-6 flex flex-col gap-6">
        {COPY.checkQuestions.map((q, qi) => (
          <fieldset key={q.id}>
            <legend className="text-[15px] font-bold">
              <span className="mr-1.5 text-muted tabular-nums">{qi + 1}</span>
              {q.label}
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options.map((option) => {
                const picked = answers[q.id] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: option }))}
                    className={[
                      'min-h-11 rounded-full border px-4 text-[14px] font-semibold transition-colors',
                      picked
                        ? 'border-mark bg-mark text-white'
                        : 'border-line bg-background text-foreground active:bg-surface',
                    ].join(' ')}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {result ? (
        <div className="mt-7 rounded-2xl border border-mark/30 bg-mark-soft p-5" role="status">
          <p className="text-[13px] font-bold text-mark">이 경우에 가까워요</p>
          <p className="mt-1.5 text-[18px] font-bold leading-[1.45] tracking-tight">{result.name}</p>
          <p className="mt-3 text-[15px] leading-[1.7]">
            <Marked text={result.body} />
          </p>
          <p className="mt-3 border-t border-mark/20 pt-3 text-[14px] font-bold leading-[1.6]">
            {result.close}
          </p>
        </div>
      ) : (
        <p className="mt-7 rounded-2xl bg-surface px-5 py-4 text-[14px] leading-[1.7] text-muted">
          세 개를 다 고르면 결과가 나와요.
        </p>
      )}

      <noscript>
        <p className="mt-4 text-[14px] leading-[1.7] text-muted">{COPY.checkFallback}</p>
      </noscript>

      <p className="mt-4 text-[13px] leading-[1.7] text-muted">{COPY.checkNote}</p>
    </div>
  );
}
