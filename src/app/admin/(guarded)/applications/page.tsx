import { setApplicationStatusAction } from '@/app/admin/actions';
import { APPLICATION_STATUS, APPLICATION_STATUSES, CLASS } from '@/config/class';
import { listApplications } from '@/lib/classes';
// 서버는 UTC 로 돈다. 그냥 찍으면 저녁 7시 신청이 오전 10시로 보인다.
import { seoulStamp } from '@/lib/kst';

export const dynamic = 'force-dynamic';

export default async function AdminApplications() {
  const rows = await listApplications();
  const live = rows.filter((r) => r.status !== 'canceled');

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 pb-12 pt-8">
      <header>
        <h1 className="text-[24px] font-bold leading-[1.35]">신청자</h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          연락처로 카카오톡을 보내고 상태를 옮겨주세요. 취소로 바꾸면 그 자리는 다시 열려요.
          신청 정보는 {CLASS.retentionDays}일 뒤 지워져요.
        </p>
        <p className="mt-2 text-[14px] font-bold">
          지금까지 {live.length}명
          {rows.length !== live.length ? <span className="font-semibold text-muted"> · 취소 {rows.length - live.length}</span> : null}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface p-5 text-[14px] leading-[1.6] text-muted">아직 신청이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-bold">{r.student_name}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{r.classTitle}</p>
                </div>
                <span className="shrink-0 text-[12px] text-muted">{seoulStamp(r.created_at)}</span>
              </div>

              <div className="mt-3 flex flex-col gap-1 text-[14px]">
                <a href={`tel:${r.parent_phone}`} className="font-bold text-brand underline underline-offset-2">
                  {r.parent_phone}
                </a>
                <p className="text-[13px] text-muted">
                  접수번호 {r.receipt_no ?? '(안 적음)'}
                  {r.receiptMatched === false ? (
                    <span className="ml-1.5 font-bold text-danger">대조 실패</span>
                  ) : r.receiptMatched === true ? (
                    <span className="ml-1.5 font-bold text-success">확인됨</span>
                  ) : null}
                </p>
              </div>

              <form action={setApplicationStatusAction} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="id" value={r.id} />
                <select
                  name="status"
                  defaultValue={r.status}
                  className="min-h-11 flex-1 rounded-xl border border-line px-3 text-[14px] outline-none focus:border-brand"
                >
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {APPLICATION_STATUS[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="min-h-11 shrink-0 rounded-xl bg-surface px-4 text-[14px] font-bold active:bg-line"
                >
                  바꾸기
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
