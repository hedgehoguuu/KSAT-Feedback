import Link from 'next/link';
import { formatStartsOn, perSession, won } from '@/config/class';
import type { ClassCard as ClassCardData } from '@/lib/classes';

type Props = {
  data: ClassCardData;
  proofUrls: string[];
};

/** 개설 클래스 한 장. 값은 전부 /admin 에서 넣는다. */
export function ClassCard({ data, proofUrls }: Props) {
  const each = perSession(data.price, data.sessions);
  const startsOn = formatStartsOn(data.starts_on);
  const credential = [data.tutor_school, data.tutor_percentile ? `국어 평균 백분위 ${data.tutor_percentile}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="rounded-2xl border border-line p-5">
      <p className="text-[17px] font-bold leading-[1.4]">{data.title}</p>
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
          <span className="text-muted">튜터</span>{' '}
          <span className="font-bold">{data.tutor_name}</span>
          {credential ? <span className="text-muted"> · {credential}</span> : null}
        </p>
      ) : null}

      {proofUrls.length > 0 ? (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-brand underline underline-offset-2">
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
        <details className="mt-3">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-brand underline underline-offset-2">
            수업 자세히 보기
          </summary>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.7] text-muted">{data.detail}</p>
        </details>
      ) : null}

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-[20px] font-bold tracking-tight">{won(data.price)}</p>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">
            {each ? `1회당 ${won(each)} · ` : ''}
            {data.price_note}
          </p>
        </div>
        <p
          className={[
            'shrink-0 text-[13px] font-bold',
            data.full ? 'text-muted' : data.seatsLeft <= 1 ? 'text-danger' : 'text-success',
          ].join(' ')}
        >
          {data.full ? '자리 마감' : `${data.capacity}자리 중 ${data.seatsLeft}자리`}
        </p>
      </div>

      {data.full ? (
        <p className="mt-3 flex min-h-13 items-center justify-center rounded-2xl bg-surface text-[15px] font-bold text-muted">
          자리가 다 찼어요
        </p>
      ) : (
        <Link
          href={`/class/${data.slug}/apply`}
          className="mt-3 flex min-h-13 items-center justify-center rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
        >
          신청하기
        </Link>
      )}
    </article>
  );
}
