import Link from 'next/link';
import { CLASS_STATUS, won } from '@/config/class';
import { listClasses } from '@/lib/classes';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function AdminClasses({ searchParams }: PageProps<'/admin'>) {
  const { saved } = await searchParams;
  const classes = await listClasses({ onlyOpen: false });
  const connected = Boolean(supabaseAdmin());

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 pb-12 pt-8">
      <header>
        <h1 className="text-[24px] font-bold leading-[1.35]">개설 클래스</h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          여기서 고치면 <span className="font-bold">/class</span> 에 바로 반영돼요. 초안은 학생에게 보이지 않아요.
        </p>
      </header>

      {saved ? (
        <p className="rounded-xl bg-brand/5 px-4 py-3 text-[14px] font-semibold text-brand">저장했어요</p>
      ) : null}

      {!connected ? (
        <p className="rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6] text-muted">
          Supabase 연결이 없어요. 환경변수를 넣고 <span className="font-bold">0005_classes.sql</span> 을 실행해주세요.
        </p>
      ) : null}

      <Link
        href="/admin/class/new"
        className="flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[15px] font-bold text-white active:bg-brand-pressed"
      >
        새 반 만들기
      </Link>

      {classes.length === 0 ? (
        <p className="rounded-2xl bg-surface p-5 text-[14px] leading-[1.6] text-muted">
          아직 만든 반이 없어요.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/class/${c.slug}`} className="block rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[15px] font-bold leading-[1.4]">{c.title}</p>
                  <span
                    className={[
                      'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold',
                      c.status === 'open'
                        ? 'bg-brand/10 text-brand'
                        : c.status === 'draft'
                          ? 'bg-surface text-muted'
                          : 'bg-surface text-muted',
                    ].join(' ')}
                  >
                    {CLASS_STATUS[c.status]}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-[1.6] text-muted">
                  {c.schedule_text} · {won(c.price)} · {c.capacity}자리 중 {c.seatsLeft}자리 남음
                </p>
                <p className="mt-0.5 text-[12px] text-muted">/class/{c.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
