import type { Metadata } from 'next';
import Link from 'next/link';
import { ApplyForm } from '@/components/ApplyForm';
import { formatStartsOn, won } from '@/config/class';
import { getClass } from '@/lib/classes';

export const dynamic = 'force-dynamic';

/**
 * 카카오톡에 이 주소를 붙였을 때 뜨는 카드.
 *
 * 관리자 화면이 안내하는 /class/{반} 이 이리로 오므로, 실제로 공유되는 링크는 이것이다.
 * 그대로 두면 모든 반이 "국어 3인 관찰반" 하나로 보인다 — 반 이름과 시간을 넣는다.
 */
export async function generateMetadata({ params }: PageProps<'/class/[slug]/apply'>): Promise<Metadata> {
  const { slug } = await params;
  const target = await getClass(slug);
  if (!target) return { title: '신청' };

  const starts = formatStartsOn(target.starts_on);
  const description = [target.schedule_text, starts ? `${starts} 시작` : null, `${target.sessions}회 ${won(target.price)}`]
    .filter(Boolean)
    .join(' · ');

  return {
    title: target.title,
    description,
    openGraph: { title: target.title, description },
  };
}

export default async function ApplyPage({ params }: PageProps<'/class/[slug]/apply'>) {
  const { slug } = await params;
  const target = await getClass(slug);

  // 초안이거나 마감이면 신청 화면을 열지 않는다. 주소를 직접 쳐도 마찬가지다.
  if (!target || target.status !== 'open' || target.full) {
    return (
      <main className="flex flex-1 flex-col justify-center px-5 py-16">
        <h1 className="text-[24px] font-bold leading-[1.35]">
          {target?.full ? '자리가 다 찼어요' : '지금 신청을 받고 있지 않아요'}
        </h1>
        <p className="mt-3 text-[15px] leading-[1.7] text-muted">
          다른 반이 열려 있는지 확인해보세요.
        </p>
        <Link
          href="/class"
          className="glass mt-6 flex min-h-13 items-center justify-center rounded-2xl text-[15px] font-bold"
        >
          열려 있는 반 보기
        </Link>
      </main>
    );
  }

  return <ApplyForm data={target} />;
}
