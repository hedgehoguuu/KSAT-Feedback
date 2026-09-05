import { won } from '@/config/class';

/**
 * 수강료. 총액 하나만 보여주고, 그 값에 무엇이 들어 있는지를 바로 아래 체크 목록으로 편다.
 * 모의고사와 스터디룸이 값에 포함된다는 사실이 이 반의 가장 강한 근거라 숨기지 않는다.
 *
 * 관리자가 적은 한 줄(`price_note`)을 가운뎃점·쉼표로 잘라 항목으로 만든다.
 * 예) '모의고사 4회분 · 스터디룸 대관료 · 수업 후 주간 피드백' → 세 줄
 */
function includedItems(note: string): string[] {
  return note
    .split(/[·,]/)
    .map((part) => part.trim().replace(/\s*포함$/, ''))
    .filter(Boolean);
}

type Props = {
  price: number;
  sessions: number;
  note: string;
};

export function PriceBlock({ price, sessions, note }: Props) {
  const items = includedItems(note);

  return (
    <div className="rounded-xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-bold text-muted">
          {sessions ? `${sessions}회 총액` : '수강료'}
        </span>
        <span className="text-[22px] font-bold tracking-tight tabular-nums">{won(price)}</span>
      </div>

      {items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-[1.5]">
              <span className="font-bold text-mark">✓</span>
              <span>
                <span className="font-bold">{item}</span>
                <span className="text-muted"> 포함</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
