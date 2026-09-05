import { formatStartsOn } from '@/config/class';
import type { ClassSummary } from '@/lib/classes';

/**
 * 반 정보를 한 줄로 이어 붙이면(“매주 목요일 19:00–22:00 · 10월 16일 시작 · 4회 · 대치역…”)
 * 학생이 필요한 값을 찾지 못한다. 이름표를 붙여 줄을 나눈다.
 *
 * 카드(/class)와 신청 화면(/class/[반]/apply)이 같은 부품을 쓴다.
 */
type Row = { label: string; value: string; sub?: string };

function rowsOf(data: ClassSummary): Row[] {
  const rows: Row[] = [];

  if (data.schedule_text) rows.push({ label: '일정', value: data.schedule_text });

  const startsOn = formatStartsOn(data.starts_on);
  const term = [startsOn ? `${startsOn} 시작` : null, data.sessions ? `${data.sessions}회` : null]
    .filter(Boolean)
    .join(' · ');
  if (term) rows.push({ label: '기간', value: term });

  if (data.location) rows.push({ label: '장소', value: data.location });

  if (data.tutor_name) {
    const credential = [
      data.tutor_school,
      data.tutor_percentile ? `국어 평균 백분위 ${data.tutor_percentile}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    rows.push({ label: '튜터', value: data.tutor_name, sub: credential || undefined });
  }

  return rows;
}

export function ClassMeta({ data }: { data: ClassSummary }) {
  const rows = rowsOf(data);
  if (rows.length === 0) return null;

  return (
    <dl className="mt-4 flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-3">
          <dt className="w-9 shrink-0 pt-px text-[13px] font-bold text-muted">{row.label}</dt>
          <dd className="text-[14px] font-semibold leading-[1.5]">
            {row.value}
            {row.sub ? (
              <span className="mt-0.5 block text-[13px] font-normal text-muted">{row.sub}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
