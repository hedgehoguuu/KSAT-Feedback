'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomBar } from '@/components/BottomBar';
import { CLASS, isPhone, isReceiptNo, normalizePhone, normalizeReceiptNo } from '@/config/class';

type Props = {
  slug: string;
  title: string;
  summary: string;
  priceLine: string;
};

/**
 * 신청 폼 (모집 페이지 PRD §06). 학생이 채우는 칸은 넷뿐이다.
 * 학년 · 이메일 · 그때 적은 고민은 묻지 않는다 — 접수번호로 조회한다.
 */
export function ApplyForm({ slug, title, summary, priceLine }: Props) {
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
          slug,
          studentName: name.trim(),
          receiptNo: normalizeReceiptNo(receipt),
          parentPhone: normalizePhone(phone),
          consent,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '신청이 안 됐어요. 다시 눌러주세요.');
      router.replace(`/class/${slug}/apply/done`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : '신청이 안 됐어요. 다시 눌러주세요.');
      inFlight.current = false;
      setPending(false);
    }
  }

  const reason = !name.trim()
    ? '학생 이름을 적어주세요'
    : !phoneOk
      ? '학부모 연락처를 적어주세요'
      : !consent
        ? '개인정보 수집·이용 동의가 필요해요'
        : null;

  return (
    <>
      <main className="flex flex-1 flex-col px-5 pb-6 pt-10">
        <h1 className="text-[24px] font-bold leading-[1.35] tracking-tight">{title}</h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">{summary}</p>
        <p className="mt-1 text-[14px] font-bold">{priceLine}</p>

        <div className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">학생 이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              autoComplete="name"
              placeholder="김주현"
              className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">9월 모의고사 피드백 접수번호</span>
            <input
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, receipt: true }))}
              maxLength={12}
              inputMode="text"
              autoCapitalize="characters"
              placeholder="F0902-013"
              className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
            />
            <span className="text-[13px] leading-[1.6] text-muted">
              접수 확인 메일에 있는 F 로 시작하는 번호예요. 못 찾으면 비워두셔도 신청은 됩니다.
            </span>
            {touched.receipt && receipt.trim().length > 0 && !receiptOk ? (
              <span className="text-[13px] text-muted">
                형식이 조금 달라요. 그대로 두셔도 저희가 확인할게요.
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">학부모 연락처</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              maxLength={13}
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-0000-0000"
              className="min-h-13 rounded-xl border border-line px-4 text-[16px] outline-none focus:border-brand"
            />
            <span className="text-[13px] leading-[1.6] text-muted">
              이 번호로 카카오톡을 드려요. 자리와 입금은 그때 안내합니다.
            </span>
            {touched.phone && phone.trim().length > 0 && !phoneOk ? (
              <span className="text-[13px] text-danger">번호를 다시 확인해주세요</span>
            ) : null}
          </label>

          <label className="flex cursor-pointer gap-3 rounded-xl bg-surface p-4">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-brand"
            />
            <span className="text-[14px] leading-[1.6]">
              개인정보 수집·이용에 동의합니다
              <span className="mt-1 block text-[13px] text-muted">
                학생 이름 · 접수번호 · 학부모 연락처를 반 편성과 수업 안내 연락에만 씁니다.
                {CLASS.retentionDays}일 뒤 지웁니다.
              </span>
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
        label="신청하기"
        onClick={onSubmit}
        disabled={!canSubmit}
        reason={reason}
        pending={pending}
      />
    </>
  );
}
