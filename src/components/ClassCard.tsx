import Link from 'next/link';
import { formatStartsOn, perSession, won } from '@/config/class';
import type { ClassCard as ClassCardData } from '@/lib/classes';

type Props = {
  data: ClassCardData;
  proofUrls: string[];
};

/**
 * 개설 클래스 한 장. 값은 전부 /admin 에서 넣는다.
 *
 * 남은 자리를 위(제목 옆)에 두는 이유: 자리가 몇 개 남았는지가 이 카드 전체를 읽는 틀이다.
 * 가격을 맨 아래 세 줄로 나눈 이유: 498,000 이라는 숫자만 크게 던지면 학생은 뒷걸음질한다.
 * 무엇이 들어 있는지가 같은 자리에 있어야 판단할 수 있다.
 */
export function ClassCard({ data, proofUrls }: Props) {
  const each = perSession(data.price, data.sessions);
  const startsOn = formatStartsOn(data.starts_on);
  const credential = [
    data.tutor_school,
    data.tutor_percentile ? `국어 평균 백분위 ${data.tutor_percentile}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="rounded-2xl border border-line p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[17px] font-bold leading-[1.4]">{data.title}</p>
        <span
          className={[
            'mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold',
            data.full
              ? 'bg-surface text-muted'
              : data.seatsLeft <= 1
                ? 'bg-mark-soft text-mark'
                : 'bg-surface text-foreground',
          ].join(' ')}
        >
          {data.full ? '마감' : `${data.seatsLeft}자리 남음`}
        </span>
      </div>

      <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">
        {data.schedule_text}
        {startsOn ? ` · ${startsOn} 시작` : ''}
        {data.sessions ? ` · ${data.sessions}회` : ''}
        {data.location ? ` · ${data.location}` : ''}
      </p>

      {data.recommend ? (
        <p className="mt-3 rounded-xl bg-surface px-3.5 py-3 text-[14px] leading-[1.6]">
          <span className="font-bold">이런 학생에게</span> {data.recommend}
        </p>
      ) : null}

      {data.tutor_name ? (
        <p className="mt-3 text-[14px] leading-[1.6]">
          <span className="text-muted">튜터</span> <span className="font-bold">{data.tutor_name}</span>
          {credential ? <span className="text-muted"> · {credential}</span> : null}
        </p>
      ) : null}

      {proofUrls.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-muted underline underline-offset-2">
            성적 증빙 보기
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {proofUrls.map((url) => (
              // 비공개 버킷의 서명 URL 이다. next/image 로 최적화하지 않고 그대로 띄운다.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="튜터 성적 증빙" className="rounded-xl border border-line" />
            ))}
          </div>
        </details>
      ) : null}

      {data.detail ? (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-muted underline underline-offset-2">
            수업 자세히 보기
          </summary>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.7] text-muted">{data.detail}</p>
        </details>
      ) : null}

      <dl className="mt-4 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[13px] text-muted">{data.sessions ? `${data.sessions}회 총액` : '수강료'}</dt>
          <dd className="text-[20px] font-bold tracking-tight tabular-nums">{won(data.price)}</dd>
        </div>
        {each ? (
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-muted">1회(180분)당</dt>
            <dd className="text-[14px] font-bold tabular-nums">{won(each)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-2.5 text-[12px] leading-[1.55] text-muted">{data.price_note}</p>

      {data.full ? (
        <p className="mt-4 flex min-h-13 items-center justify-center rounded-2xl bg-surface text-[15px] font-bold text-muted">
          자리가 다 찼어요
        </p>
      ) : (
        <Link
          href={`/class/${data.slug}/apply`}
          className="mt-4 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
        >
          신청하기
        </Link>
      )}
    </article>
  );
}
