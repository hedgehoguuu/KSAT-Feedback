/**
 * 시험지 사진을 작게 늘어놓는다. 누르면 새 창에 크게 열린다.
 * 주소는 볼 때마다 새로 만든 임시 주소라(한 시간) 화면을 오래 열어 두면 닫힐 수 있다 —
 * 그때는 새로고침하면 된다고 적어 둔다.
 */
export function PhotoStrip({
  photos,
  empty,
  unreadable = [],
}: {
  photos: { id: string; url: string | null }[];
  empty: string;
  /** 사진 읽기가 흐려서 못 읽은 사진 */
  unreadable?: string[];
}) {
  if (photos.length === 0) return <p className="text-[13px] leading-[1.6] text-muted">{empty}</p>;
  const blurry = new Set(unreadable);

  return (
    <div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {photos.map((photo, i) => (
          <li key={photo.id} className="relative">
            {photo.url ? (
              <a
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className={`block aspect-3/4 overflow-hidden rounded-xl bg-surface ${blurry.has(photo.id) ? 'ring-2 ring-danger' : ''}`}
              >
                {/* 비공개 저장소의 임시 주소라 next/image 최적화 대상이 아니다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`시험지 ${i + 1}쪽`} className="h-full w-full object-cover" loading="lazy" />
              </a>
            ) : (
              <span className="flex aspect-3/4 items-center justify-center rounded-xl bg-surface px-1 text-center text-[11px] text-muted">
                {i + 1}쪽 · 못 불러왔어요
              </span>
            )}
            {blurry.has(photo.id) ? (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-xl bg-danger/90 py-0.5 text-center text-[11px] font-bold text-white">
                흐려서 못 읽음
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted">
        누르면 크게 열려요. 사진 주소는 한 시간 뒤 닫히니, 안 열리면 새로고침해 주세요.
      </p>
    </div>
  );
}
