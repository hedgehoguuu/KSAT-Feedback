'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AutoTextarea } from '@/components/AutoTextarea';
import { BottomBar } from '@/components/BottomBar';
import {
  isAnswered,
  itemsOf,
  questionsFor,
  type ConcernItem,
  type ConcernValue,
  type Question,
} from '@/config/questions.config';
import { isSubjectCode, subjectLabel, type SubjectCode } from '@/config/subjects';
import { filledSubjects } from '@/lib/flow';
import { useApply } from '@/lib/store';

export default function ConcernStep() {
  const router = useRouter();
  const params = useParams<{ subject: string }>();
  const examCode = useApply((s) => s.examCode);
  const selected = useApply((s) => s.subjects);
  const photos = useApply((s) => s.photos);
  const concerns = useApply((s) => s.concerns);
  const setConcern = useApply((s) => s.setConcern);

  const [askSkip, setAskSkip] = useState(false);

  const targets = filledSubjects(examCode, selected, photos);
  const raw = params?.subject ?? '';
  const subject = isSubjectCode(raw) ? (raw as SubjectCode) : null;
  const at = subject ? targets.indexOf(subject) : -1;

  useEffect(() => {
    if (targets.length === 0) router.replace('/apply/upload');
    else if (at < 0) router.replace(`/apply/concerns/${targets[0]}`);
  }, [at, targets, router]);

  if (!subject || at < 0) return null;

  const questions = questionsFor(subject);
  const answers = concerns[subject] ?? {};
  const allEmpty = questions.every((q) => !isAnswered(q, answers[q.id]));
  const isLast = at === targets.length - 1;
  const goNext = () =>
    router.push(isLast ? '/apply/email' : `/apply/concerns/${targets[at + 1]}`);

  function onNext() {
    // 비워도 넘어갈 수 있다. 대신 한 번만 부드럽게 확인한다 (FE-5 AC)
    if (allEmpty) setAskSkip(true);
    else goNext();
  }

  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-6">
        <header>
          <p className="text-[13px] font-semibold text-brand">
            {`${targets.length}과목 중 ${at + 1}번째 · ${subjectLabel(subject)}`}
          </p>
          <h1 className="mt-2 text-[24px] font-bold leading-[1.35]">
            {`${subjectLabel(subject)}, 어땠어요?`}
          </h1>
          <p className="mt-2 text-[15px] text-muted">편하게, 생각나는 대로 적어도 돼요. 정답 없어요.</p>
          <p className="mt-3 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6] text-muted">
            <span className="font-bold text-foreground">{questions.length}개 모두 선택이에요.</span>{' '}
            답하고 싶은 것만 적어도 되고, 하나도 안 적고 넘어가도 괜찮아요.
          </p>
        </header>

        <ol className="flex flex-col gap-7">
          {questions.map((q, i) => (
            <li key={q.id} className="flex flex-col gap-2">
              <label htmlFor={`${subject}-${q.id}`} className="flex gap-2 text-[15px] font-bold leading-[1.5]">
                <span className="shrink-0 text-muted tabular-nums">{i + 1}.</span>
                <span>{q.label.replace('{subject}', subjectLabel(subject))}</span>
              </label>
              {q.helper ? <p className="-mt-1 pl-6 text-[13px] text-muted">{q.helper}</p> : null}
              <div className="pl-6">
                <Field
                  question={q}
                  id={`${subject}-${q.id}`}
                  value={answers[q.id]}
                  onChange={(v) => setConcern(subject, q.id, v)}
                />
              </div>
            </li>
          ))}
        </ol>

        <p className="text-[13px] leading-relaxed text-muted">
          한 개만 적어도 도움이 많이 돼요. 많이 적을수록 피드백이 정확해지고요.
        </p>
      </main>

      <BottomBar label={isLast ? '다 적었어요' : '다음 과목'} onClick={onNext} />

      {askSkip ? (
        <SkipSheet
          onStay={() => setAskSkip(false)}
          onGo={() => {
            setAskSkip(false);
            goNext();
          }}
        />
      ) : null}
    </>
  );
}

function Field({
  question,
  id,
  value,
  onChange,
}: {
  question: Question;
  id: string;
  value: ConcernValue | undefined;
  onChange: (v: ConcernValue) => void;
}) {
  if (question.type === 'items') {
    return <ItemsField id={id} value={itemsOf(value)} onChange={onChange} />;
  }

  const text = typeof value === 'string' ? value : '';

  if (question.type === 'short') {
    return (
      <input
        id={id}
        type="text"
        value={text}
        placeholder={question.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-13 w-full rounded-xl border border-line bg-background px-4 text-[16px] outline-none placeholder:text-muted focus:border-brand"
      />
    );
  }

  return <AutoTextarea id={id} value={text} onChange={onChange} placeholder={question.placeholder} />;
}

/**
 * 문항 번호와 어려웠던 이유를 한 줄씩 쌓는 입력.
 * 폭이 좁아 번호와 이유를 나란히 두면 둘 다 못 쓰게 되므로 세로로 쌓는다.
 */
function ItemsField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ConcernItem[];
  onChange: (v: ConcernItem[]) => void;
}) {
  // 처음 들어오면 빈 줄 하나를 보여준다. 버튼을 먼저 찾게 하지 않기 위해서.
  const rows = value.length > 0 ? value : [{ no: '', why: '' }];

  const patch = (i: number, part: Partial<ConcernItem>) =>
    onChange(rows.map((row, at) => (at === i ? { ...row, ...part } : row)));

  const remove = (i: number) => {
    const next = rows.filter((_, at) => at !== i);
    onChange(next.length > 0 ? next : [{ no: '', why: '' }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-xl border border-line bg-background p-3">
          <div className="flex items-center gap-2">
            <input
              id={i === 0 ? id : undefined}
              type="text"
              inputMode="numeric"
              value={row.no}
              placeholder="예) 14번"
              aria-label={`${i + 1}번째 문항 번호`}
              onChange={(e) => patch(i, { no: e.target.value })}
              className="min-h-12 w-[124px] shrink-0 rounded-lg border border-line bg-background px-3 text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-muted focus:border-brand"
            />
            {rows.length > 1 || row.no.trim() || row.why.trim() ? (
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`${i + 1}번째 문항 지우기`}
                className="ml-auto min-h-12 rounded-lg px-3 text-[14px] font-semibold text-muted active:bg-surface"
              >
                지우기
              </button>
            ) : null}
          </div>
          <input
            type="text"
            value={row.why}
            placeholder="어려웠던 이유 — 예) 계산이 안 맞아서 세 번 다시 했어요"
            aria-label={`${i + 1}번째 문항이 어려웠던 이유`}
            onChange={(e) => patch(i, { why: e.target.value })}
            className="mt-2 min-h-12 w-full rounded-lg border border-line bg-background px-3 text-[16px] outline-none placeholder:text-muted focus:border-brand"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, { no: '', why: '' }])}
        className="min-h-12 rounded-xl border border-dashed border-line text-[15px] font-semibold text-muted active:bg-surface"
      >
        + 문항 추가
      </button>
    </div>
  );
}

function SkipSheet({ onStay, onGo }: { onStay: () => void; onGo: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
      <div className="w-full max-w-[448px] rounded-2xl bg-background p-5">
        <p className="text-[17px] font-bold leading-[1.45]">안 적고 넘어가도 돼요</p>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          대신 피드백이 조금 뭉뚱그려질 수 있어요. 한 줄만 적어도 훨씬 정확해져요.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onStay}
            className="min-h-13 flex-1 rounded-xl bg-brand text-[15px] font-bold text-white active:bg-brand-pressed"
          >
            적어볼게요
          </button>
          <button
            type="button"
            onClick={onGo}
            className="min-h-13 rounded-xl bg-surface px-5 text-[15px] font-semibold text-muted active:bg-line"
          >
            그냥 넘길래요
          </button>
        </div>
      </div>
    </div>
  );
}
