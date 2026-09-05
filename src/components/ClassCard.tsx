import Link from 'next/link';
import { ClassMeta } from '@/components/ClassMeta';
import { PriceBlock } from '@/components/PriceBlock';
import { RichText } from '@/components/RichText';
import type { ClassCard as ClassCardData } from '@/lib/classes';

type Props = {
  data: ClassCardData;
  proofUrls: string[];
};

/** 개설 클래스 한 장. 값은 전부 /admin 에서 넣는다. */
export function ClassCard({ data, proofUrls }: Props) {
  return (
    <article className="rounded-2xl border border-line p-5">
      {/* 남은 자리 수는 학생에게 보여주지 않는다. 자리가 다 찼는지는 아래 버튼이 말한다. */}
      <p className="text-[17px] font-bold leading-[1.4]">{data.title}</p>

      <ClassMeta data={data} />

      {data.recommend ? (
        <div className="mt-4 rounded-xl bg-surface px-4 py-3.5">
          <p className="text-[12px] font-bold text-mark">추천 학생</p>
          <p className="mt-1 text-[14px] leading-[1.6]">{data.recommend}</p>
        </div>
      ) : null}

      {proofUrls.length > 0 || data.detail ? (
        <div className="mt-3 flex flex-col gap-2">
          {proofUrls.length > 0 ? (
            <details>
              <summary className="cursor-pointer list-none text-[13px] font-semibold text-muted underline underline-offset-2">
                튜터 성적 증빙 보기
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
            <details>
              <summary className="cursor-pointer list-none text-[13px] font-semibold text-muted underline underline-offset-2">
                수업 자세히 보기
              </summary>
              <div className="mt-3">
                <RichText text={data.detail} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <PriceBlock price={data.price} sessions={data.sessions} note={data.price_note} />
      </div>

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
