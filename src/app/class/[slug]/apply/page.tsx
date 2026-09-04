import Link from 'next/link';
import { ApplyForm } from '@/components/ApplyForm';
import { formatStartsOn, perSession, won } from '@/config/class';
import { getClass } from '@/lib/classes';

export const dynamic = 'force-dynamic';

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
          className="mt-6 flex min-h-13 items-center justify-center rounded-2xl bg-surface text-[15px] font-bold"
        >
          열려 있는 반 보기
        </Link>
      </main>
    );
  }

  const startsOn = formatStartsOn(target.starts_on);
  const each = perSession(target.price, target.sessions);

  return (
    <ApplyForm
      slug={target.slug}
      title={target.title}
      summary={[
        target.schedule_text,
        startsOn ? `${startsOn} 시작` : null,
        target.sessions ? `${target.sessions}회` : null,
        target.location || null,
      ]
        .filter(Boolean)
        .join(' · ')}
      priceLine={`${won(target.price)}${each ? ` · 1회당 ${won(each)}` : ''}`}
    />
  );
}
