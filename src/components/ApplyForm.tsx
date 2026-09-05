'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomBar } from '@/components/BottomBar';
import { ClassMeta } from '@/components/ClassMeta';
import { PriceBlock } from '@/components/PriceBlock';
import { isPhone, isReceiptNo, normalizePhone, normalizeReceiptNo } from '@/config/class';
import { APPLY } from '@/config/class-copy';
import type { ClassSummary } from '@/lib/classes';

// 입력칸도 유리 위에 놓인다. 흐림은 걸지 않고(글자가 흔들린다) 살짝 비치게만 채운다.
const FIELD =
  'min-h-13 rounded-2xl border border-line bg-white/70 px-4 text-[16px] outline-none focus:border-brand focus:bg-white';
const LABEL = 'text-[14px] font-bold';
const HELP = 'text-[13px] leading-[1.6] text-muted';

/**
 * 신청 폼 (모집 페이지 PRD §06). 학생이 채우는 칸은 넷뿐이다.
 * 학년 · 이메일 · 그때 적은 고민은 묻지 않는다 — 접수번호로 조회한다.
 */
export function ApplyForm({ data }: { data: ClassSummary }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [receipt, setReceipt] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<{ phone?: boolean; receipt?: boolean }>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // setPending 은 다음 렌더에나 반영된다. 연타를 같은 틱에서 막으려면 ref 가 필요하다.
  const inFlight = useRef(false);

  const phoneOk = isPhone(phone);
  const receiptOk = isReceiptNo(receipt);
  const canSubmit = name.trim().length > 0 && phoneOk && consent;

  async function onSubmit() {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);

    try {
      const res = await fetch('/api/class/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: data.slug,
          studentName: name.trim(),
          receiptNo: normalizeReceiptNo(receipt),
          parentPhone: normalizePhone(phone),
          consent,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? APPLY.failed);
      router.replace(`/class/${data.slug}/apply/done`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : APPLY.failed);
      inFlight.current = false;
      setPending(false);
    }
  }

  const reason = !name.trim()
    ? APPLY.needName
    : !phoneOk
      ? APPLY.needPhone
      : !consent
        ? APPLY.needConsent
        : null;

  return (
    <>
      <main className="flex flex-1 flex-col px-5 pb-6 pt-10">
        {/* 무엇을 신청하는지 — 카드에서 보던 것과 같은 모양으로 다시 보여준다 */}
        <section className="glass-solid rounded-[22px] p-5">
          <h1 className="text-[19px] font-bold leading-[1.4] tracking-tight">{data.title}</h1>
          <ClassMeta data={data} />
          <div className="mt-5">
            <PriceBlock price={data.price} sessions={data.sessions} note={data.price_note} />
          </div>
        </section>

        <div className="mt-9 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{APPLY.nameLabel}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              autoComplete="name"
              placeholder="김주현"
              className={FIELD}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{APPLY.receiptLabel}</span>
            <input
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, receipt: true }))}
              maxLength={12}
              inputMode="text"
              autoCapitalize="characters"
              placeholder="F0902-013"
              className={FIELD}
            />
            <span className={HELP}>{APPLY.receiptHelp}</span>
            {touched.receipt && receipt.trim().length > 0 && !receiptOk ? (
              <span className="text-[13px] text-muted">{APPLY.receiptShapeHint}</span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{APPLY.phoneLabel}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => {
                setTouched((t) => ({ ...t, phone: true }));
                // 숫자만 적어도 보기 좋게 맞춰 준다. 서버도 같은 함수로 다시 맞춘다.
                setPhone((v) => normalizePhone(v));
              }}
              maxLength={13}
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-0000-0000"
              className={FIELD}
            />
            <span className={HELP}>{APPLY.phoneHelp}</span>
            {touched.phone && phone.trim().length > 0 && !phoneOk ? (
              <span className="text-[13px] text-danger">{APPLY.phoneError}</span>
            ) : null}
          </label>

          <label className="glass-inset flex cursor-pointer gap-3 rounded-2xl p-4">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-brand"
            />
            <span className="text-[14px] leading-[1.6]">
              {APPLY.consentLabel}
              <span className="mt-1 block text-[13px] text-muted">{APPLY.consentDetail}</span>
            </span>
          </label>
        </div>

        {failure ? (
          <p className="mt-5 rounded-xl bg-danger/10 px-4 py-3 text-[14px] leading-[1.6] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
      </main>

      <BottomBar
        label={APPLY.submit}
        onClick={onSubmit}
        disabled={!canSubmit}
        reason={reason}
        pending={pending}
      />
    </>
  );
}
