'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomBar } from '@/components/BottomBar';
import { POLICY } from '@/config/app';
import { subjectLabel } from '@/config/subjects';
import { clearDraftId } from '@/lib/draft';
import { isValidEmail, suggestEmail } from '@/lib/email';
import { filledSubjects } from '@/lib/flow';
import { useApply } from '@/lib/store';
import { submitApplication } from '@/lib/submit';

export default function EmailStep() {
  const router = useRouter();
  const examCode = useApply((s) => s.examCode);
  const subjects = useApply((s) => s.subjects);
  const photos = useApply((s) => s.photos);
  const email = useApply((s) => s.email);
  const consent = useApply((s) => s.consent);
  const ageOk = useApply((s) => s.ageOk);
  const setEmail = useApply((s) => s.setEmail);
  const setConsent = useApply((s) => s.setConsent);
  const setAgeOk = useApply((s) => s.setAgeOk);
  const complete = useApply((s) => s.complete);

  const [touched, setTouched] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // setPending 은 다음 렌더에나 반영된다. 연타를 같은 틱에서 막으려면 ref 가 필요하다 (FE-6 AC)
  const inFlight = useRef(false);

  const targets = filledSubjects(examCode, subjects, photos);
  const uploaded = photos.filter((p) => p.status === 'done').length;
  const valid = isValidEmail(email);
  // 형식 오류는 입력 중이 아니라 포커스가 빠질 때 알려준다 (FE-6 AC)
  const showError = touched && email.trim().length > 0 && !valid;
  const canSubmit = valid && consent && ageOk && targets.length > 0;

  async function onSubmit() {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await submitApplication();
      complete({
        receiptNo: result.receiptNo,
        dueDate: result.dueDate,
        email: email.trim(),
        examCode: examCode!,
        subjects: targets.map((code) => ({
          code,
          photoCount: photos.filter((p) => p.subject === code && p.status === 'done').length,
        })),
      });
      clearDraftId();
      router.replace(`/done/${result.receiptNo}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : '제출이 안 됐어요. 다시 눌러주시면 이어서 보낼게요.');
      inFlight.current = false;
      setPending(false);
    }
  }

  const reason = !valid
    ? '이메일을 적어주세요'
    : !consent
      ? '개인정보 수집·이용 동의가 필요해요'
      : !ageOk
        ? `만 ${POLICY.minAge}세 이상인지 확인해주세요`
        : null;

  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pb-6 pt-6">
        <header>
          <h1 className="text-[24px] font-bold leading-[1.35]">분석 결과를 어디로 보내드릴까요?</h1>
          <p className="mt-2 text-[15px] text-muted">이메일 말고는 아무것도 안 물어봐요. 이름도, 학교도요.</p>
        </header>

        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-[14px] font-bold">
            이메일
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            placeholder="example@naver.com"
            onChange={(e) => {
              setEmail(e.target.value);
              if (suggestion) setSuggestion(null);
            }}
            onBlur={() => {
              setTouched(true);
              setSuggestion(suggestEmail(email));
            }}
            className={[
              'min-h-13 w-full rounded-xl border bg-background px-4 text-[16px] outline-none placeholder:text-muted',
              showError ? 'border-danger' : 'border-line focus:border-brand',
            ].join(' ')}
          />
          {showError ? (
            <p className="text-[13px] text-danger">이메일 형식이 조금 이상해요. 다시 봐줄래요?</p>
          ) : null}
          {!showError && suggestion ? (
            <button
              type="button"
              onClick={() => {
                setEmail(suggestion);
                setSuggestion(null);
              }}
              className="self-start rounded-lg bg-surface px-3 py-2 text-[13px] font-semibold text-brand"
            >
              {`${suggestion} 아닐까요?`}
            </button>
          ) : null}
        </div>

        <section className="rounded-2xl bg-surface p-4">
          <h2 className="text-[14px] font-bold">이렇게 접수돼요</h2>
          <dl className="mt-2 flex flex-col gap-1 text-[14px]">
            <Row label="과목" value={targets.map((c) => subjectLabel(c)).join(', ') || '-'} />
            <Row label="사진" value={`${uploaded}장`} />
            <Row label="회신" value={`${POLICY.replySlaDays}일 안에 이메일로`} />
          </dl>
        </section>

        <div className="flex flex-col gap-3">
          <Check checked={consent} onChange={setConsent}>
            <span className="font-semibold">개인정보 수집·이용에 동의합니다</span>
            <span className="mt-1 block text-[13px] leading-[1.6] text-muted">
              이메일·시험지 사진·고민 내용을 피드백 회신 목적으로만 써요. 이름·학교·전화번호는 받지 않아요.
            </span>
          </Check>
          <Check checked={ageOk} onChange={setAgeOk}>
            <span className="font-semibold">만 {POLICY.minAge}세 이상이에요</span>
          </Check>
        </div>
      </main>

      <BottomBar
        label="분석 요청하기"
        onClick={() => void onSubmit()}
        disabled={!canSubmit}
        pending={pending}
        reason={failure ?? reason}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--brand)]"
      />
      <span className="text-[14px] leading-[1.5]">{children}</span>
    </label>
  );
}
