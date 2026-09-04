import Link from 'next/link';
import { ClassCard } from '@/components/ClassCard';
import { AGENDA, BLOCKS, CLASS } from '@/config/class';
import { BRANDING } from '@/config/app';
import { listClasses, signProofUrls } from '@/lib/classes';

// 관리자에서 고친 값이 바로 보여야 한다. 캐시하지 않는다.
export const dynamic = 'force-dynamic';

/** 실제 수업에서 나온 기록 네 줄. 이 페이지에서 가장 설득력 있는 자산이라 가공하지 않는다. */
const OBSERVED = [
  { part: '선택 (언어와 매체)', spent: '18분', gap: '+3', note: '11번에서 3분 체류, 선지 두 번 왕복' },
  { part: '독서 1지문', spent: '12분', gap: null, note: '지문 통독 후 문항. 밑줄·소거 표시 없음' },
  { part: '독서 2지문', spent: '21분', gap: '+9', note: '8번에서 손 멈춤 40초, 지문 위로 두 번 복귀' },
  { part: '문학 3지문', spent: '17분', gap: '−8', note: '종료 4분 전 일괄 마킹. 마지막 4문항 임의 표기' },
];

const TAKEAWAY = [
  { title: '빨간펜 필기본', detail: '튜터가 그날 시험지에 그대로 적어 준 것' },
  { title: '지문별 시간 기록표', detail: '어디서 몇 분을 썼는지 위 표 그대로' },
  { title: '고칠 행동 한 줄', detail: '다음 회차까지 딱 하나만' },
];

const FOR_YOU = [
  '다른 사람이 푸는 걸 옆에서 보면 자극을 받는 학생',
  '아는데 시간이 모자라서 틀리는 학생',
  '자기 습관을 지적받을 준비가 된 학생',
  '혼자 풀 때와 시험장에서의 자기가 다르다고 느끼는 학생',
];

const NOT_FOR_YOU = [
  '개념이 아직 안 잡힌 학생 — 80분을 채우지 못하면 관찰할 것이 없어요',
  '전 문항 해설을 원하는 학생 — 해설은 90분 중 30분이에요',
  '옆에서 지켜보는 것이 불편한 학생',
];

export default async function ClassLanding() {
  const classes = await listClasses({ onlyOpen: true });
  const proofUrls = await signProofUrls(classes.flatMap((c) => c.proof_paths));

  return (
    <main className="flex flex-1 flex-col pb-14">
      {/* ── 첫 화면 ─────────────────────────────────────────────── */}
      <section className="px-5 pt-14">
        <p className="text-[13px] font-bold tracking-tight text-brand">
          국어 · 3인 팀수업 · {CLASS.minutes}분
        </p>
        <h1 className="mt-3 text-[30px] font-bold leading-[1.32] tracking-tight">
          시험지에는
          <br />
          결과만 남습니다
        </h1>
        <p className="mt-4 text-[16px] leading-[1.7] text-muted">
          어떤 순서로 풀었는지, 어디서 몇 분을 썼는지는 사진에 남지 않아요. 그래서 시험을 치는
          중에 옆에 앉습니다. 튜터가 지문별 시간을 재고, 오래 걸린 문항을 적고, 그 기록으로 남은
          90분을 이야기해요.
        </p>

        <div className="mt-6 flex gap-2">
          <Link
            href="#classes"
            className="flex min-h-13 flex-1 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
          >
            열려 있는 반 보기
          </Link>
        </div>
      </section>

      {/* ── 180분 구조 ──────────────────────────────────────────── */}
      <section className="mt-14 px-5">
        <h2 className="text-[22px] font-bold leading-[1.4] tracking-tight">
          {CLASS.minutes}분을 이렇게 씁니다
        </h2>

        {/* 80:10:90 을 눈금 그대로 그린다. 칸에 글자를 넣으면 좁은 칸이 밀려 비율이 깨지므로
            이름은 아래 목록에서 말한다. */}
        <div className="mt-5 grid gap-1" style={{ gridTemplateColumns: '80fr 10fr 90fr' }}>
          <div className="flex h-16 min-w-0 items-end rounded-lg bg-brand px-2.5 pb-2 text-[14px] font-bold text-white">
            80분
          </div>
          <div className="h-16 min-w-0 rounded-lg bg-surface" aria-hidden />
          <div className="flex h-16 min-w-0 items-end rounded-lg border border-line px-2.5 pb-2 text-[14px] font-bold">
            90분
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted">
          <span>00:00</span>
          <span>03:00</span>
        </div>

        <ul className="mt-4 flex flex-col gap-2.5">
          {BLOCKS.map((b) => (
            <li key={b.label} className="flex gap-2.5 text-[14px] leading-[1.6]">
              <span className="w-10 shrink-0 font-bold tabular-nums">{b.minutes}분</span>
              <span>
                <span className="font-bold">{b.label}</span>
                <span className="text-muted"> — {b.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-9 text-[16px] font-bold">80분 — 튜터는 기록만 합니다</h3>
        <p className="mt-2 text-[14px] leading-[1.7] text-muted">
          개입하지 않아요. 적는 것은 두 가지 — 학생별 지문별 풀이 시간과, 오래 걸린 문항.
        </p>
        <ul className="mt-4 overflow-hidden rounded-2xl border border-line">
          {OBSERVED.map((row) => (
            <li key={row.part} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-bold">{row.part}</span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums">
                  {row.spent}
                  {row.gap ? <span className="ml-1 font-semibold text-muted">계획 대비 {row.gap}</span> : null}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-[1.55] text-muted">{row.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-[1.6] text-muted">실제 수업 기록지에서 그대로 가져온 네 줄이에요.</p>

        <h3 className="mt-9 text-[16px] font-bold">90분 — 그 기록을 펴 놓고</h3>
        <ul className="mt-3 flex flex-col gap-2.5">
          {AGENDA.map((row) => (
            <li key={row.at} className="flex gap-3">
              <span className="w-11 shrink-0 pt-0.5 text-[12px] font-bold tabular-nums text-muted">{row.at}</span>
              <span>
                <span className="text-[15px] font-bold">{row.what}</span>
                <span className="ml-1.5 text-[13px] text-muted">{row.minutes}분</span>
                <span className="block text-[13px] leading-[1.6] text-muted">{row.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 받아가는 것 ─────────────────────────────────────────── */}
      <section className="mt-14 bg-surface px-5 py-10">
        <h2 className="text-[22px] font-bold leading-[1.4] tracking-tight">매주 세 가지를 들고 갑니다</h2>
        <ul className="mt-5 flex flex-col gap-3">
          {TAKEAWAY.map((t) => (
            <li key={t.title} className="rounded-2xl bg-background p-4">
              <p className="text-[15px] font-bold">{t.title}</p>
              <p className="mt-1 text-[13px] leading-[1.6] text-muted">{t.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] leading-[1.7] text-muted">
          수업이 끝난 뒤 한 주 동안의 학습 피드백도 수강료에 들어 있어요.
        </p>
      </section>

      {/* ── 대상 ────────────────────────────────────────────────── */}
      <section className="mt-14 px-5">
        <h2 className="text-[22px] font-bold leading-[1.4] tracking-tight">
          정원은 3명이에요.
          <br />
          그래서 이렇게 고릅니다
        </h2>

        <div className="mt-5 rounded-2xl bg-brand/5 p-5">
          <p className="text-[15px] font-bold text-brand">이런 학생과 합니다</p>
          <ul className="mt-3 flex flex-col gap-2">
            {FOR_YOU.map((line) => (
              <li key={line} className="flex gap-2 text-[14px] leading-[1.6]">
                <span className="text-brand">·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-2xl border border-line p-5">
          <p className="text-[15px] font-bold">이런 학생은 다른 곳이 나아요</p>
          <ul className="mt-3 flex flex-col gap-2">
            {NOT_FOR_YOU.map((line) => (
              <li key={line} className="flex gap-2 text-[14px] leading-[1.6] text-muted">
                <span>·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 border-l-2 border-brand pl-4 text-[17px] font-bold leading-[1.6]">
          학생의 행동을 관찰해서, 나아지게 하는 수업.
        </p>
      </section>

      {/* ── 개설 클래스 ─────────────────────────────────────────── */}
      <section id="classes" className="mt-14 scroll-mt-4 px-5">
        <h2 className="text-[22px] font-bold leading-[1.4] tracking-tight">지금 열려 있는 반</h2>

        {classes.length === 0 ? (
          <div className="mt-5 rounded-2xl bg-surface p-6">
            <p className="text-[16px] font-bold">지금은 열린 반이 없어요</p>
            <p className="mt-2 text-[14px] leading-[1.7] text-muted">
              다음 반이 열리면 알려드릴게요. 아래 메일로 학년과 연락처를 남겨주세요.
            </p>
            <a
              href={`mailto:${BRANDING.contactEmail}?subject=${encodeURIComponent('[관찰반] 다음 반 알림 신청')}`}
              className="mt-3 inline-block text-[14px] font-bold text-brand underline underline-offset-2"
            >
              {BRANDING.contactEmail}
            </a>
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {classes.map((c) => (
              <ClassCard
                key={c.id}
                data={c}
                proofUrls={c.proof_paths.map((p) => proofUrls.get(p)).filter((u): u is string => Boolean(u))}
              />
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-14 px-5 text-[13px] leading-[1.7] text-muted">
        <p>
          9월 모의고사 시험지 피드백을 보내드렸던 팀과외팀이에요. 그때 시험지에서 본 것을, 이번엔
          시험을 치는 중에 봅니다.
        </p>
        <a
          href={`mailto:${BRANDING.contactEmail}`}
          className="mt-2 inline-block font-semibold text-brand underline underline-offset-2"
        >
          {BRANDING.contactEmail}
        </a>
      </footer>
    </main>
  );
}
