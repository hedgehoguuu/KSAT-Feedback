import Link from 'next/link';
import { ClassCard } from '@/components/ClassCard';
import { Marked } from '@/components/Marked';
import { Reveal } from '@/components/Reveal';
import { SelfCheck } from '@/components/SelfCheck';
import { BRANDING } from '@/config/app';
import { CLASS } from '@/config/class';
import { COPY } from '@/config/class-copy';
import { listClasses, signProofUrls } from '@/lib/classes';

// 관리자에서 고친 값이 바로 보여야 한다. 캐시하지 않는다.
export const dynamic = 'force-dynamic';

const H2 = 'text-[22px] font-bold leading-[1.4] tracking-tight';

export default async function ClassLanding() {
  const classes = await listClasses({ onlyOpen: true });
  const proofUrls = await signProofUrls(classes.flatMap((c) => c.proof_paths));

  return (
    <main className="flex flex-1 flex-col pb-16">
      {/* ── ① 학생이 이미 손에 쥔 것에서 시작한다 ──────────────── */}
      <section className="px-5 pt-14">
        <Reveal>
          <p className="text-[13px] font-bold tracking-tight text-muted">{COPY.eyebrow}</p>
        </Reveal>

        <Reveal delay={90}>
          <div className="mt-5 rounded-2xl border border-line p-5">
            <p className="text-[12px] font-bold text-muted">{COPY.docTitle}</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {COPY.docLines.map((line) => (
                <li key={line} className="flex items-center gap-2.5 text-[14px] font-bold">
                  <span className="text-[9px] text-mark">■</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={180}>
          <h1 className="mt-8 text-[32px] font-bold leading-[1.3] tracking-tight">
            <Marked text={COPY.hero} />
          </h1>
        </Reveal>

        <Reveal delay={250}>
          <p className="mt-5 text-[16px] leading-[1.75] text-muted">
            <Marked text={COPY.heroBody} />
          </p>
        </Reveal>

        <Reveal delay={320}>
          <Link
            href="#check"
            className="mt-8 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
          >
            {COPY.heroCta}
          </Link>
          <Link
            href="#classes"
            className="mt-3 flex min-h-11 items-center justify-center text-[14px] font-semibold text-muted underline underline-offset-4"
          >
            {COPY.heroCtaSecond}
          </Link>
        </Reveal>
      </section>

      {/* ── ② 자가진단 ─────────────────────────────────────────── */}
      <section id="check" className="mt-20 scroll-mt-4 bg-surface px-5 py-12">
        <Reveal>
          <h2 className={H2}>{COPY.checkTitle}</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.checkLead}</p>
        </Reveal>
        <Reveal delay={80}>
          <SelfCheck />
        </Reveal>
      </section>

      {/* ── ③ 180분 ────────────────────────────────────────────── */}
      <section className="mt-16 px-5">
        <Reveal>
          <h2 className={H2}>{COPY.structureTitle}</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.structureLead}</p>
        </Reveal>

        <Reveal delay={80}>
          {/* 80:10:90 을 눈금 그대로 그린다 */}
          <div className="mt-6 grid gap-1" style={{ gridTemplateColumns: '80fr 10fr 90fr' }}>
            <div className="flex h-16 min-w-0 items-end rounded-lg bg-brand px-2.5 pb-2 text-[14px] font-bold text-white">
              80분
            </div>
            <div className="h-16 min-w-0 rounded-lg bg-line" aria-hidden />
            <div className="flex h-16 min-w-0 items-end rounded-lg border border-line px-2.5 pb-2 text-[14px] font-bold">
              90분
            </div>
          </div>
          <ul className="mt-5 flex flex-col gap-2.5">
            {COPY.blocks.map((b) => (
              <li key={b.label} className="flex gap-3 text-[14px] leading-[1.6]">
                <span className="w-9 shrink-0 font-bold tabular-nums text-muted">{b.minutes}′</span>
                <span>
                  <span className="font-bold">{b.label}</span>
                  {b.detail ? <span className="text-muted"> — {b.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={140}>
          <h3 className="mt-11 text-[16px] font-bold">{COPY.observeTitle}</h3>
          <ul className="mt-4 flex flex-col gap-px overflow-hidden rounded-2xl bg-line">
            {COPY.observed.map((row) => (
              <li key={row.part} className="bg-background px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold">{row.part}</span>
                  <span className="shrink-0 text-[14px] font-bold tabular-nums">
                    {row.spent}
                    {row.over ? <span className="ml-1.5 text-mark">{row.over}</span> : null}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-[1.55] text-muted">{row.note}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">{COPY.observeNote}</p>
        </Reveal>

        <Reveal delay={200}>
          <h3 className="mt-11 text-[16px] font-bold">{COPY.agendaTitle}</h3>
          <ul className="mt-4 flex flex-col gap-3">
            {COPY.agenda.map((row) => (
              <li key={row.at} className="flex items-baseline gap-3">
                <span className="w-11 shrink-0 text-[12px] font-bold tabular-nums text-muted">{row.at}</span>
                <span className="text-[16px] font-bold">{row.what}</span>
                <span className="ml-auto text-[13px] tabular-nums text-muted">{row.minutes}분</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* ── ④ 들고 가는 것 ─────────────────────────────────────── */}
      <section className="mt-16 bg-surface px-5 py-12">
        <Reveal>
          <h2 className={H2}>{COPY.takeawayTitle}</h2>
        </Reveal>
        <Reveal delay={80}>
          <ul className="mt-5 flex flex-col gap-2">
            {COPY.takeaway.map((t) => (
              <li key={t.title} className="rounded-xl bg-background px-4 py-4">
                <p className="text-[15px] font-bold">
                  <Marked text={t.title} />
                </p>
                <p className="mt-1 text-[13px] leading-[1.6] text-muted">{t.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-[1.7] text-muted">{COPY.takeawayNote}</p>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-8 border-t border-line pt-7">
            <p className="text-[16px] font-bold">{COPY.outcomeTitle}</p>
            <p className="mt-2.5 text-[15px] leading-[1.75]">
              <Marked text={COPY.outcomeBody} />
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── ⑤ 대상 ─────────────────────────────────────────────── */}
      <section className="mt-16 px-5">
        <Reveal>
          <h2 className={H2}>
            <Marked text={COPY.audienceTitle} />
          </h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.audienceLead}</p>
        </Reveal>

        <Reveal delay={80}>
          <div className="mt-6">
            <p className="text-[15px] font-bold">{COPY.forYouTitle}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {COPY.forYou.map((line) => (
                <li key={line} className="flex gap-2.5 text-[15px] leading-[1.6]">
                  <span className="text-mark">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-7 border-t border-line pt-6">
            <p className="text-[15px] font-bold text-muted">{COPY.notForYouTitle}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {COPY.notForYou.map((line) => (
                <li key={line} className="flex gap-2.5 text-[15px] leading-[1.6] text-muted">
                  <span>·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-10 text-[21px] font-bold leading-[1.55] tracking-tight">
            <Marked text={COPY.quote} />
          </p>
        </Reveal>
      </section>

      {/* ── ⑥ 자주 묻는 것 ─────────────────────────────────────── */}
      <section className="mt-16 px-5">
        <Reveal>
          <h2 className={H2}>{COPY.faqTitle}</h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-4 border-t border-line">
            {COPY.faq.map((item) => (
              <details key={item.q} className="group border-b border-line py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-[15px] font-bold leading-[1.55]">
                  {item.q}
                  <span className="mt-0.5 shrink-0 text-[18px] font-normal text-muted transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[14px] leading-[1.75] text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── ⑦ 개설 클래스 ──────────────────────────────────────── */}
      <section id="classes" className="mt-16 scroll-mt-4 px-5">
        <Reveal>
          <h2 className={H2}>{COPY.classesTitle}</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.classesLead}</p>
        </Reveal>

        {classes.length === 0 ? (
          <Reveal delay={80}>
            <div className="mt-5 rounded-2xl bg-surface p-6">
              <p className="text-[16px] font-bold">{COPY.emptyTitle}</p>
              <p className="mt-2 text-[14px] leading-[1.7] text-muted">{COPY.emptyBody}</p>
              <a
                href={`mailto:${BRANDING.contactEmail}?subject=${encodeURIComponent('[관찰반] 다음 반 알림 신청')}`}
                className="mt-3 inline-block text-[14px] font-bold text-brand underline underline-offset-2"
              >
                {BRANDING.contactEmail}
              </a>
            </div>
          </Reveal>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {classes.map((c, i) => (
              <li key={c.id}>
                <Reveal delay={i * 90}>
                  <ClassCard
                    data={c}
                    proofUrls={c.proof_paths
                      .map((p) => proofUrls.get(p))
                      .filter((u): u is string => Boolean(u))}
                  />
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 px-5 text-[13px] leading-[1.7] text-muted">
        <p>{COPY.footer}</p>
        <a
          href={`mailto:${BRANDING.contactEmail}`}
          className="mt-1 inline-block font-semibold text-brand underline underline-offset-2"
        >
          {BRANDING.contactEmail}
        </a>
        <p className="mt-4 text-[12px]">주 1회 {CLASS.minutes}분 · 정원 3명</p>
      </footer>
    </main>
  );
}
