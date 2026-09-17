import type { PublishStatus } from '@/config/lms';
import { PHOTO_READ_ERRORS } from '@/config/lms';
import { seoulStamp } from '@/lib/kst';
import type { AnswersSource } from '@/lib/lms/exams';
import type { ReadView } from '@/lib/lms/photo-read-state';
import { ConfirmSubmit } from './ConfirmSubmit';
import { ReadWatcher } from './ReadWatcher';
import { Card, btnGhost } from './Shell';

const FLASH: Record<string, string> = {
  queued: '사진을 다시 읽기 시작했어요.',
  off: 'ANTHROPIC_API_KEY 가 없어 사진을 읽을 수 없어요.',
  applied: '사진에서 읽은 답으로 채점을 다시 채웠어요.',
  kept: '점수를 공개한 뒤라 채점을 바꾸지 않았어요.',
};

const nos = (list: number[]) => list.join(', ');

/**
 * 채점 화면 위의 '사진으로 채점' 칸. 사진 읽기가 어디까지 왔고, 무엇을 매겼고,
 * 사람이 무엇을 봐야 하는지를 말한다.
 */
export function PhotoReadPanel({
  attemptId,
  view,
  requestNo,
  configured,
  photoCount,
  source,
  gradeStatus,
  differs,
  pending,
  flash,
  reread,
  apply,
}: {
  attemptId: string;
  view: ReadView;
  requestNo: number;
  configured: boolean;
  photoCount: number;
  source: AnswersSource | null;
  gradeStatus: PublishStatus;
  /** 튜터 채점과 읽은 답이 다른 번호 */
  differs: number[];
  /** 확인할 문항 가운데 아직 아무도 안 매긴 번호 */
  pending: number[];
  flash: string | null;
  reread: (formData: FormData) => Promise<void>;
  apply: (formData: FormData) => Promise<void>;
}) {
  const rereadButton = (labelText: string) => (
    <form action={reread}>
      <input type="hidden" name="attempt_id" value={attemptId} />
      <button type="submit" className={btnGhost} disabled={!configured || photoCount === 0}>
        {labelText}
      </button>
    </form>
  );

  return (
    <Card
      title="사진으로 채점"
      action={view.kind === 'done' || view.kind === 'failed' || view.kind === 'stuck' ? rereadButton('다시 읽기') : undefined}
    >
      {/* '읽기 시작' 알림은 읽는 동안만. 끝난 뒤에도 남으면 지금 상태와 어긋난다. */}
      {flash && FLASH[flash] && !(flash === 'queued' && view.kind !== 'reading') ? (
        <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-[13px]" role="status">
          {FLASH[flash]}
        </p>
      ) : null}

      {!configured && view.kind !== 'done' ? (
        <p className="text-[14px] leading-[1.7] text-muted">
          사진 자동 채점이 꺼져 있어요. ANTHROPIC_API_KEY 를 넣으면 학생이 올린 시험지 사진에서 답을 읽어 채점을
          채워요.
        </p>
      ) : view.kind === 'none' ? (
        photoCount === 0 ? (
          <p className="text-[14px] leading-[1.7] text-muted">
            학생이 시험지 사진을 올리면 사진에서 학생 답을 읽어 정답과 맞춰 채점을 채워요.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] leading-[1.7]">사진 {photoCount}장을 아직 읽지 않았어요.</p>
            {rereadButton('사진 읽기')}
          </div>
        )
      ) : view.kind === 'reading' ? (
        <div>
          <p className="text-[14px] font-bold leading-[1.7]" aria-live="polite">
            사진 {photoCount}장에서 학생 답을 읽는 중이에요. 1–3분쯤 걸려요.
          </p>
          <ReadWatcher key={requestNo} url={`/lms/attempts/${attemptId}/read-status`} active />
        </div>
      ) : view.kind === 'stuck' ? (
        <p className="text-[14px] font-bold leading-[1.7] text-danger">
          읽기가 {seoulStamp(view.since)} 에 시작한 뒤 멈춘 것 같아요. 다시 읽어 주세요.
        </p>
      ) : view.kind === 'failed' ? (
        <p className="text-[14px] font-bold leading-[1.7] text-danger">
          사진을 읽지 못했어요 — {PHOTO_READ_ERRORS[view.error] ?? view.error}
        </p>
      ) : (
        <Done
          view={view}
          source={source}
          gradeStatus={gradeStatus}
          differs={differs}
          pending={pending}
          attemptId={attemptId}
          apply={apply}
        />
      )}
    </Card>
  );
}

function Done({
  view,
  source,
  gradeStatus,
  differs,
  pending,
  attemptId,
  apply,
}: {
  view: Extract<ReadView, { kind: 'done' }>;
  source: AnswersSource | null;
  gradeStatus: PublishStatus;
  differs: number[];
  pending: number[];
  attemptId: string;
  apply: (formData: FormData) => Promise<void>;
}) {
  const readCount = view.answers.filter((a) => a.sure || a.answer !== null).length;
  const tutorOwned = source === 'tutor';

  // 확인할 문항의 이유. 같은 이유(예: '찾지 못함')는 번호를 모아 한 줄로 적는다.
  // 이미 매긴 문항은 뺀다 — 사람이 사진을 보고 정한 것이다.
  const open = new Set(pending);
  const reasons = new Map<string, number[]>();
  for (const a of view.answers) {
    if (a.sure || !a.note || !open.has(a.no)) continue;
    reasons.set(a.note, [...(reasons.get(a.note) ?? []), a.no]);
  }

  return (
    <div className="flex flex-col gap-2 text-[14px] leading-[1.7]">
      <p>
        <span className="font-bold">
          사진 {view.photos}장에서 {view.sure}문항을 확실히 읽었어요
        </span>
        <span className="text-muted">{view.at ? ` · ${seoulStamp(view.at)}` : ''}</span>
      </p>

      {view.stale ? (
        <p className="font-bold text-danger">읽은 뒤에 학생이 사진을 바꿨어요. 다시 읽어 주세요.</p>
      ) : null}

      {gradeStatus === 'published' ? (
        <p className="text-muted">점수를 공개한 뒤라 사진 읽기는 채점을 바꾸지 않아요.</p>
      ) : source === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-bold text-check">읽은 답이 아직 채점에 들어가지 않았어요.</p>
          <form action={apply}>
            <input type="hidden" name="attempt_id" value={attemptId} />
            <button type="submit" className={btnGhost}>
              읽은 답으로 매기기
            </button>
          </form>
        </div>
      ) : tutorOwned ? (
        differs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-bold text-check">
              직접 매긴 채점과 사진에서 읽은 답이 {differs.length}문항 달라요: {nos(differs)}
            </p>
            <form action={apply}>
              <input type="hidden" name="attempt_id" value={attemptId} />
              <ConfirmSubmit
                className={btnGhost}
                message={'직접 매긴 정오가 모두 사진에서 읽은 답으로 바뀝니다.\n\n확실히 읽힌 문항만 매기고, 애매한 문항은 비워 둬요. 총평은 그대로예요.'}
              >
                읽은 답으로 다시 매기기
              </ConfirmSubmit>
            </form>
          </div>
        ) : (
          <p className="text-muted">직접 매긴 채점과 사진에서 읽은 답이 같아요.</p>
        )
      ) : (
        <p>
          확실히 읽힌 답을 정답과 맞춰 매겼어요.{' '}
          <span className="text-muted">아래에서 확인하고 저장하면 직접 매긴 채점이 돼요.</span>
        </p>
      )}

      {pending.length > 0 ? (
        <div className="rounded-lg bg-check-soft px-3 py-2 text-check">
          <p className="font-bold">
            확인할 문항 {pending.length}개: {nos(pending)}
            <span className="font-normal"> — 아래 칸에 노랗게 표시했어요. 사진을 보고 직접 매겨 주세요.</span>
          </p>
          {reasons.size > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-[12px] leading-[1.6]">
              {[...reasons].map(([reason, list]) => (
                <li key={reason}>
                  <span className="font-bold">{list.map((n) => `${n}번`).join(' · ')}</span> {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : view.check.length > 0 ? (
        <p className="text-muted">애매하게 읽힌 문항({nos(view.check)})은 모두 매겼어요.</p>
      ) : readCount > 0 ? (
        <p className="text-muted">확인할 문항이 없어요.</p>
      ) : null}

      {view.blanks.length > 0 ? (
        <p className="text-muted">빈칸으로 읽혀 틀림으로 매긴 문항: {nos(view.blanks)}</p>
      ) : null}

      {view.unreadable.length > 0 ? (
        <p className="font-bold text-danger">
          흐리거나 잘려서 읽지 못한 사진이 {view.unreadable.length}장 있어요. 위 사진에 표시했어요.
        </p>
      ) : null}

      {view.note ? <p className="text-[12px] text-muted">읽은 메모: {view.note}</p> : null}
    </div>
  );
}
