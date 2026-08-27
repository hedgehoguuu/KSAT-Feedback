'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FEATURES, POLICY } from '@/config/app';
import { findExam } from '@/config/exams';
import { subjectLabel } from '@/config/subjects';
import { useApply, useHydrated } from '@/lib/store';

export default function DonePage() {
  const params = useParams<{ receiptNo: string }>();
  const hydrated = useHydrated();
  const receipt = useApply((s) => s.receipt);
  const [interested, setInterested] = useState(false);

  const receiptNo = decodeURIComponent(params?.receiptNo ?? '');
  // 새로고침해도 접수번호로 이 화면이 유지된다 (FE-7 AC)
  const mine = receipt && receipt.receiptNo === receiptNo ? receipt : null;
  const exam = findExam(mine?.examCode);

  if (!hydrated) {
    return <div className="flex flex-1 items-center justify-center p-10 text-[14px] text-muted">불러오는 중…</div>;
  }

  return (
    <main className="flex flex-1 flex-col px-5 pb-10 pt-14">
      <p className="text-[40px] leading-none">✅</p>
      <h1 className="mt-4 text-[28px] font-bold leading-[1.35]">접수됐어요!</h1>

      {mine ? (
        <p className="mt-3 text-[16px] leading-[1.6] text-muted">
          <span className="font-bold text-foreground">{mine.dueDate}</span>까지{' '}
          <span className="font-bold text-foreground">{mine.email}</span>로 보내드릴게요.
        </p>
      ) : (
        <p className="mt-3 text-[16px] leading-[1.6] text-muted">
          적어주신 이메일로 {POLICY.replySlaDays}일 안에 보내드릴게요.
        </p>
      )}

      <div className="mt-7 rounded-2xl bg-surface p-5">
        <p className="text-[13px] text-muted">접수번호</p>
        <p className="mt-1 text-[24px] font-bold tracking-tight">{receiptNo}</p>
        <p className="mt-2 text-[13px] leading-[1.6] text-muted">
          혹시 문의할 일이 생기면 이 번호를 알려주세요.
        </p>
      </div>

      {mine ? (
        <dl className="mt-5 flex flex-col gap-2 text-[14px]">
          <Row label="시험" value={exam?.shortLabel ?? '-'} />
          <Row label="과목" value={mine.subjects.map((s) => subjectLabel(s.code)).join(', ')} />
          <Row
            label="사진"
            value={mine.subjects.map((s) => `${subjectLabel(s.code)} ${s.photoCount}장`).join(' · ')}
          />
          <Row label="회신 예정일" value={mine.dueDate} />
        </dl>
      ) : (
        <p className="mt-5 text-[13px] leading-[1.6] text-muted">
          접수 내용 요약은 접수했던 그 기기·브라우저에서만 보여요. 접수 자체는 정상적으로 들어와 있어요.
        </p>
      )}

      {FEATURES.conversionCta ? (
        <div className="mt-7 rounded-2xl border border-line p-4">
          {interested ? (
            <p className="text-[14px] leading-[1.6] text-muted">
              회신 메일에서 안내드릴게요. 추가로 받는 정보는 없어요.
            </p>
          ) : (
            <>
              <p className="text-[15px] font-bold">시험지 말고, 직접 얘기해볼래요?</p>
              <button
                type="button"
                onClick={() => setInterested(true)}
                className="mt-3 min-h-12 w-full rounded-xl bg-surface text-[15px] font-semibold active:bg-line"
              >
                과외도 궁금해요
              </button>
            </>
          )}
        </div>
      ) : null}

      <p className="mt-auto pt-10 text-center text-[12px] leading-relaxed text-muted">
        보내주신 시험지 사진은 분석이 끝나고 {POLICY.retentionDays}일 뒤에 지워요.
        <br />
        <Link href="/" className="underline underline-offset-2">
          처음 화면으로
        </Link>
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
