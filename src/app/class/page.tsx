import { ClassBuddy } from '@/components/ClassBuddy';
import { ClassCard } from '@/components/ClassCard';
import { ClassGallery } from '@/components/ClassGallery';
import { Marked } from '@/components/Marked';
import { Reveal } from '@/components/Reveal';
import { BRANDING } from '@/config/app';
import { COPY } from '@/config/class-copy';
import { listClasses, signProofUrls } from '@/lib/classes';

// 관리자에서 고친 값이 바로 보여야 한다. 캐시하지 않는다.
export const dynamic = 'force-dynamic';

const H2 = 'text-[22px] font-bold leading-[1.4] tracking-tight';

export default async function ClassLanding() {
  const { rows: classes, failed } = await listClasses({ onlyOpen: true });
  const proofUrls = await signProofUrls(classes.flatMap((c) => c.proof_paths));

  return (
    <main className="flex flex-1 flex-col pb-28">
      {/* ── ① 학생이 이미 손에 쥔 것에서 시작한다 ──────────────── */}
      <section className="px-5 pt-14">
        <Reveal>
          <p className="text-[13px] font-bold tracking-tight text-muted">{COPY.eyebrow}</p>
        </Reveal>

        <Reveal delay={90}>
          <div className="glass mt-5 rounded-[22px] p-5">
            <p className="text-[12px] font-bold text-muted">{COPY.docTitle}</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {COPY.docLines.map((line, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[14px] font-bold">
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
      </section>

      {/* ── ② 180분 ────────────────────────────────────────────── */}
      <section className="mt-16 px-5">
        <Reveal>
          <h2 className={H2}>{COPY.structureTitle}</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.structureLead}</p>
        </Reveal>

        <Reveal delay={80}>
          {/* 80:10:90 을 눈금 그대로 그린다 */}
          <div className="mt-6 grid gap-1" style={{ gridTemplateColumns: '80fr 10fr 90fr' }}>
            <div className="glass flex h-16 min-w-0 items-end rounded-xl px-2.5 pb-2 text-[14px] font-bold">
              80분
            </div>
            <div className="h-16 min-w-0 rounded-xl bg-foreground/15" aria-hidden />
            <div className="flex h-16 min-w-0 items-end rounded-xl bg-brand px-2.5 pb-2 text-[14px] font-bold text-white shadow-[0_10px_24px_-10px_rgb(49_130_246/0.8)]">
              90분
            </div>
          </div>
          <ul className="mt-5 flex flex-col gap-2.5">
            {COPY.blocks.map((b, i) => (
              <li key={i} className="flex gap-3 text-[14px] leading-[1.6]">
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
          <ul className="glass glass-divide mt-4 flex flex-col overflow-hidden rounded-[22px]">
            {COPY.observed.map((row, i) => (
              <li key={i} className="px-4 py-3.5">
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
        </Reveal>

        <Reveal delay={200}>
          <h3 className="mt-11 text-[16px] font-bold">{COPY.agendaTitle}</h3>
          <ul className="mt-4 flex flex-col gap-3">
            {COPY.agenda.map((row, i) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="w-11 shrink-0 text-[12px] font-bold tabular-nums text-muted">{row.at}</span>
                <span className="text-[16px] font-bold">{row.what}</span>
                <span className="ml-auto text-[13px] tabular-nums text-muted">{row.minutes}분</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* ── ③ 들고 가는 것 ─────────────────────────────────────── */}
      <section className="mt-16 bg-foreground/[0.035] px-5 py-12">
        <Reveal>
          <h2 className={H2}>{COPY.takeawayTitle}</h2>
        </Reveal>
        <Reveal delay={80}>
          <ul className="mt-5 flex flex-col gap-2">
            {COPY.takeaway.map((t, i) => (
              <li key={i} className="glass rounded-2xl px-4 py-4">
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

      {/* ── ④ 대상 ─────────────────────────────────────────────── */}
      <section className="mt-16 px-5">
        <Reveal>
          <h2 className={H2}>
            <Marked text={COPY.audienceTitle} />
          </h2>
        </Reveal>

        <Reveal delay={80}>
          <div className="mt-6">
            <p className="text-[15px] font-bold">{COPY.forYouTitle}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {COPY.forYou.map((line, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-[1.6]">
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
              {COPY.notForYou.map((line, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-[1.6] text-muted">
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

      {/* ── ⑤ 개설 클래스 ──────────────────────────────────────── */}
      {/* 관찰이(아래 챗봇)의 "신청하러 가기" 가 굴러오는 자리다.
          id 를 바꾸면 config/class-copy.ts 의 BUDDY 쪽 href 도 같이 바꿔야 한다.
          tabIndex 는 눈에 보이는 이동만이 아니라 화면 읽기의 자리도 여기로 옮기기 위한 것이다. */}
      <section id="classes" tabIndex={-1} className="mt-16 scroll-mt-4 px-5 outline-none">
        <Reveal>
          <h2 className={H2}>{COPY.classesTitle}</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-muted">{COPY.classesLead}</p>
        </Reveal>

        {/* 프로모션은 반마다 반복하지 않는다 — 카드 안에 넣으면 반의 정보처럼 읽힌다.
            목록 위에 한 번만 두고, 흰 유리 카드들과 달리 빨간 쪽으로 칠해 구분한다.
            열린 반이 없으면 내보내지 않는다 — 신청할 수 없는 수업의 혜택은 광고가 아니다. */}
        {COPY.promo.title && !failed && classes.length > 0 ? (
          <Reveal delay={60}>
            <div className="glass mt-5 flex items-center gap-3.5 rounded-[22px] bg-mark-soft/70 p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-mark text-[16px] font-bold tabular-nums text-white shadow-[0_8px_18px_-8px_rgb(229_52_43/0.8)]">
                {COPY.promo.badge}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-tight text-mark">{COPY.promo.label}</p>
                <p className="mt-1 text-[15px] font-bold leading-[1.45]">{COPY.promo.title}</p>
                <p className="mt-0.5 text-[14px] leading-[1.5] text-muted">
                  <Marked text={COPY.promo.body} />
                </p>
              </div>
            </div>
          </Reveal>
        ) : null}

        {/* 세 가지 상태를 구분한다. '못 불러왔다' 를 '반이 없다' 로 보여주면
            데이터베이스가 흔들리는 동안 찾아온 사람을 전부 놓친다. */}
        {failed ? (
          <Reveal delay={80}>
            <div className="glass mt-5 rounded-[22px] p-6" role="alert">
              <p className="text-[16px] font-bold">{COPY.failedTitle}</p>
              <p className="mt-2 text-[14px] leading-[1.7] text-muted">{COPY.failedBody}</p>
              <a
                href={`mailto:${BRANDING.contactEmail}?subject=${encodeURIComponent('[관찰반] 반 정보가 안 보여요')}`}
                className="mt-3 inline-block text-[14px] font-bold text-brand underline underline-offset-2"
              >
                {BRANDING.contactEmail}
              </a>
            </div>
          </Reveal>
        ) : classes.length === 0 ? (
          <Reveal delay={80}>
            <div className="glass mt-5 rounded-[22px] p-6">
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
          <Reveal delay={80}>
            <ClassGallery>
              {classes.map((c) => (
                <li key={c.id}>
                  <ClassCard
                    data={c}
                    proofUrls={c.proof_paths
                      .map((p) => proofUrls.get(p))
                      .filter((u): u is string => Boolean(u))}
                  />
                </li>
              ))}
            </ClassGallery>
          </Reveal>
        )}
      </section>

      {/* 떠 있는 챗봇. Reveal 바깥에 둔다 — 떠오르는 동안 transform 이 걸린 조상 안에서는
          position: fixed 가 화면이 아니라 그 조상을 기준으로 붙는다. */}
      <ClassBuddy />
    </main>
  );
}
