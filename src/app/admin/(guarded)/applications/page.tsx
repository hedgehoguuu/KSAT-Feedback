import { setApplicationStatusAction } from '@/app/admin/actions';
import { APPLICATION_STATUS, APPLICATION_STATUSES, CLASS } from '@/config/class';
import { listApplications } from '@/lib/classes';
// 서버는 UTC 로 돈다. 그냥 찍으면 저녁 7시 신청이 오전 10시로 보인다.
import { seoulStamp } from '@/lib/kst';

export const dynamic = 'force-dynamic';

export default async function AdminApplications() {
  const { rows, failed } = await listApplications();
  const live = rows.filter((r) => r.status !== 'canceled');

  return (
    <main className="flex flex-1 flex-col gap-5 px-5 pb-12 pt-8">
      <header>
        <h1 className="text-[24px] font-bold leading-[1.35]">신청자</h1>
        <p className="mt-2 text-[14px] leading-[1.6] text-muted">
          연락처로 카카오톡을 보내고 상태를 옮겨주세요. 취소로 바꾸면 그 자리는 다시 열려요.
          신청 정보는 {CLASS.retentionDays}일 뒤 지워져요.
        </p>
        {/* 못 불러왔으면 인원수를 말하지 않는다 — '0명' 도 틀린 말이다. */}
        {failed ? null : (
          <p className="mt-2 text-[14px] font-bold">
            지금까지 {live.length}명
            {rows.length !== live.length ? <span className="font-semibold text-muted"> · 취소 {rows.length - live.length}</span> : null}
          </p>
        )}
      </header>

      {failed ? (
        <p className="rounded-2xl bg-danger/10 p-5 text-[14px] leading-[1.6] text-danger" role="alert">
          <span className="font-bold">신청자 목록을 불러오지 못했어요.</span> 신청이 없다는 뜻이 아니에요 —
          잠시 뒤 새로고침해주세요. 계속 이러면 /setup 에서 DB 연결을 확인해주세요.
        </p>
      ) : rows.length === 0 ? (
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

              {/* 알림 메일이 실패한 신청. 메일함에는 아무것도 안 왔을 테니, 이 줄이
                  그 신청의 존재를 알리는 유일한 자리다. 성공은 따로 말하지 않는다 —
                  메일이 이미 왔다는 것이 곧 성공이라, 화면에서 한 번 더 말할 이유가 없다. */}
              {r.alert_error ? (
                <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2.5 text-[13px] leading-[1.55] text-danger">
                  <span className="font-bold">알림 메일이 안 갔어요</span> — 이 신청은 메일함에
                  없어요. 아래 연락처로 직접 연락해주세요.
                  <span className="mt-1 block break-all font-normal opacity-80">{r.alert_error}</span>
                </p>
              ) : null}

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
