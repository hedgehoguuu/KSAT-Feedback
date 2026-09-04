import Link from 'next/link';
import { BRANDING } from '@/config/app';
import { getClass } from '@/lib/classes';

export const dynamic = 'force-dynamic';

export default async function ApplyDonePage({ params }: PageProps<'/class/[slug]/apply/done'>) {
  const { slug } = await params;
  const target = await getClass(slug);

  return (
    <main className="flex flex-1 flex-col px-5 pb-10 pt-14">
      <p className="text-[40px] leading-none">✅</p>
      <h1 className="mt-4 text-[28px] font-bold leading-[1.35]">신청됐어요!</h1>
      <p className="mt-3 text-[16px] leading-[1.7] text-muted">
        남겨주신 <span className="font-bold text-foreground">학부모 연락처로 카카오톡</span> 드릴게요.
        자리와 입금은 그때 안내합니다.
      </p>

      {target ? (
        <div className="mt-7 rounded-2xl bg-surface p-5">
          <p className="text-[13px] text-muted">신청한 반</p>
          <p className="mt-1 text-[17px] font-bold leading-[1.4]">{target.title}</p>
          <p className="mt-1 text-[13px] leading-[1.6] text-muted">
            {target.schedule_text}
            {target.location ? ` · ${target.location}` : ''}
          </p>
        </div>
      ) : null}

      <p className="mt-6 text-[14px] leading-[1.7] text-muted">
        연락이 오지 않거나 바꿀 것이 있으면 아래로 알려주세요.
      </p>
      <a
        href={`mailto:${BRANDING.contactEmail}?subject=${encodeURIComponent('[관찰반] 신청 문의')}`}
        className="mt-1 inline-block text-[14px] font-bold text-brand underline underline-offset-2"
      >
        {BRANDING.contactEmail}
      </a>

      <Link
        href="/class"
        className="mt-auto flex min-h-13 items-center justify-center rounded-2xl bg-surface text-[15px] font-bold"
      >
        수업 소개 다시 보기
      </Link>
    </main>
  );
}
