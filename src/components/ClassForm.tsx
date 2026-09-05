import {
  CLASS,
  CLASS_STATUS,
  CLASS_STATUSES,
} from '@/config/class';
import { deleteClassAction, removeProofAction, saveClassAction, uploadProofAction } from '@/app/admin/actions';
import type { ClassCard } from '@/lib/classes';

type Props = {
  data: ClassCard | null;
  proofs: { path: string; url: string }[];
  error?: string;
};

const input =
  'min-h-12 rounded-xl border border-line px-3.5 text-[15px] outline-none focus:border-brand';
const label = 'flex flex-col gap-1.5';
const labelText = 'text-[13px] font-bold';
const hint = 'text-[12px] leading-[1.5] text-muted';

/** 반 만들기 · 고치기 폼. PRD §04 의 필드를 그대로 담는다. */
export function ClassForm({ data, proofs, error }: Props) {
  const isNew = data === null;

  return (
    <main className="flex flex-1 flex-col px-5 pb-14 pt-8">
      <h1 className="text-[24px] font-bold leading-[1.35]">{isNew ? '새 반 만들기' : data.title}</h1>
      {!isNew ? <p className="mt-1 text-[13px] text-muted">/class/{data.slug}</p> : null}

      {error ? (
        <p className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-[14px] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <form action={saveClassAction} className="mt-6 flex flex-col gap-4">
        {/* 저장이 막혔을 때 어느 화면으로 되돌릴지. 새 반은 아직 주소가 없다 */}
        <input type="hidden" name="mode" value={isNew ? 'new' : 'edit'} />

        <label className={label}>
          <span className={labelText}>주소 (slug)</span>
          <input
            name="slug"
            defaultValue={data?.slug ?? ''}
            readOnly={!isNew}
            required
            placeholder="korean-thu-19"
            className={`${input} ${isNew ? '' : 'bg-surface text-muted'}`}
          />
          <span className={hint}>영문 소문자·숫자·하이픈. 만든 뒤에는 바꾸지 않아요.</span>
        </label>

        <label className={label}>
          <span className={labelText}>반 이름</span>
          <input name="title" defaultValue={data?.title ?? ''} required placeholder="국어 실전 관찰반 · 목요일" className={input} />
        </label>

        <label className={label}>
          <span className={labelText}>시간</span>
          <input
            name="schedule_text"
            defaultValue={data?.schedule_text ?? ''}
            required
            placeholder="매주 목요일 19:00–22:00"
            className={input}
          />
        </label>

        <div className="flex gap-3">
          <label className={`${label} flex-1`}>
            <span className={labelText}>시작일</span>
            <input type="date" name="starts_on" defaultValue={data?.starts_on ?? ''} className={input} />
          </label>
          <label className={`${label} w-28`}>
            <span className={labelText}>회차</span>
            <input
              type="number"
              name="sessions"
              min={1}
              max={30}
              defaultValue={data?.sessions ?? CLASS.defaultSessions}
              className={input}
            />
          </label>
        </div>

        <label className={label}>
          <span className={labelText}>장소</span>
          <input
            name="location"
            defaultValue={data?.location ?? ''}
            placeholder="대치역 도보 5분 스터디룸"
            className={input}
          />
          <span className={hint}>정확한 위치는 신청 후 카톡으로 안내해요.</span>
        </label>

        <div className="mt-2 border-t border-line pt-4">
          <p className="text-[15px] font-bold">튜터</p>
          <p className={`${hint} mt-1`}>한 반은 한 튜터가 끝까지 가요.</p>
        </div>

        <label className={label}>
          <span className={labelText}>이름</span>
          <input name="tutor_name" defaultValue={data?.tutor_name ?? ''} placeholder="서현" className={input} />
        </label>

        <div className="flex gap-3">
          <label className={`${label} flex-1`}>
            <span className={labelText}>학교 · 학번</span>
            <input name="tutor_school" defaultValue={data?.tutor_school ?? ''} placeholder="○○대 24" className={input} />
          </label>
          <label className={`${label} w-28`}>
            <span className={labelText}>평균 백분위</span>
            <input
              type="number"
              name="tutor_percentile"
              step="0.1"
              min={0}
              max={100}
              defaultValue={data?.tutor_percentile ?? ''}
              placeholder="97"
              className={input}
            />
            <span className={hint}>카드에서 빨간 칩으로 강조돼요.</span>
          </label>
        </div>

        <div className="mt-2 border-t border-line pt-4">
          <p className="text-[15px] font-bold">학생에게 보일 설명</p>
        </div>

        <label className={label}>
          <span className={labelText}>추천 학생</span>
          <input
            name="recommend"
            defaultValue={data?.recommend ?? ''}
            placeholder="시간이 모자라 뒷 지문을 버리는 학생"
            className={input}
          />
          <span className={hint}>한 줄로. 카드에서 「추천 학생」으로 보여요.</span>
        </label>

        <label className={label}>
          <span className={labelText}>수업 상세 설명</span>
          <textarea
            name="detail"
            defaultValue={data?.detail ?? ''}
            rows={10}
            placeholder={'## 첫 회차에는\n- 9월 시험지를 함께 봅니다\n- **관찰할 지점**을 정하고 시작해요\n\n2회차부터 사설 실전 모의고사를 씁니다.'}
            className="rounded-xl border border-line px-3.5 py-3 text-[15px] leading-[1.7] outline-none focus:border-brand"
          />
          <span className={hint}>
            학생 화면의 「수업 자세히 보기」에 들어가요. 아래처럼 적으면 서식이 붙습니다.
          </span>
          <ul className="mt-1 flex flex-col gap-1 rounded-xl bg-surface px-3.5 py-3 text-[12px] leading-[1.7] text-muted">
            <li>
              <b className="text-foreground">## 큰 제목</b> · <b className="text-foreground">### 작은 제목</b> — 줄 앞에 붙여요
            </li>
            <li>
              <b className="text-foreground">- 항목</b> — 줄 앞에 붙이면 점 목록이 돼요
            </li>
            <li>
              <b className="text-foreground">**굵게**</b> · <b className="text-foreground">__밑줄__</b> ·{' '}
              <b className="text-foreground">*빨간 강조*</b>
            </li>
            <li>빈 줄을 넣으면 문단이 나뉘어요</li>
          </ul>
        </label>

        <div className="mt-2 border-t border-line pt-4">
          <p className="text-[15px] font-bold">모집</p>
        </div>

        <div className="flex gap-3">
          <label className={`${label} flex-1`}>
            <span className={labelText}>수강료 (원)</span>
            <input
              type="number"
              name="price"
              min={0}
              step={1000}
              defaultValue={data?.price ?? CLASS.defaultPrice}
              className={input}
            />
          </label>
          <label className={`${label} w-28`}>
            <span className={labelText}>모집 인원</span>
            <input
              type="number"
              name="capacity"
              min={1}
              max={20}
              defaultValue={data?.capacity ?? CLASS.defaultCapacity}
              className={input}
            />
          </label>
        </div>

        <label className={label}>
          <span className={labelText}>수강료에 포함되는 것</span>
          <input
            name="price_note"
            defaultValue={data?.price_note ?? CLASS.defaultPriceNote}
            className={input}
          />
          <span className={hint}>
            가운뎃점(·)으로 나눠 적으면 카드에서 「✓ … 포함」 한 줄씩으로 펴져요.
          </span>
        </label>

        <div className="flex gap-3">
          <label className={`${label} flex-1`}>
            <span className={labelText}>상태</span>
            <select name="status" defaultValue={data?.status ?? 'draft'} className={input}>
              {CLASS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLASS_STATUS[s]}
                </option>
              ))}
            </select>
            <span className={hint}>초안은 /class 에 안 보여요.</span>
          </label>
          <label className={`${label} w-28`}>
            <span className={labelText}>정렬</span>
            <input type="number" name="sort_order" defaultValue={data?.sort_order ?? 0} className={input} />
          </label>
        </div>

        <button
          type="submit"
          className="mt-2 min-h-13 rounded-2xl bg-brand text-[16px] font-bold text-white active:bg-brand-pressed"
        >
          저장하기
        </button>
      </form>

      {!isNew ? (
        <section className="mt-10 border-t border-line pt-6">
          <p className="text-[15px] font-bold">성적 증빙</p>
          <p className={`${hint} mt-1`}>
            올리기 전에 이름·수험번호·생년월일을 가려주세요. 학생 화면에서 펼쳐 볼 수 있어요.
          </p>

          {proofs.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-3">
              {proofs.map((p) => (
                <li key={p.path} className="rounded-xl border border-line p-3">
                  {/* 비공개 버킷의 서명 URL 이라 next/image 로 최적화하지 않는다 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="성적 증빙" className="w-full rounded-lg" />
                  <form action={removeProofAction} className="mt-2">
                    <input type="hidden" name="slug" value={data.slug} />
                    <input type="hidden" name="path" value={p.path} />
                    <button type="submit" className="text-[13px] font-semibold text-danger underline underline-offset-2">
                      이 증빙 지우기
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={uploadProofAction} className="mt-4 flex flex-col gap-2">
            <input type="hidden" name="slug" value={data.slug} />
            <input
              type="file"
              name="proof"
              accept="image/jpeg,image/png,image/webp"
              required
              className="text-[14px]"
            />
            <button
              type="submit"
              className="min-h-12 rounded-xl bg-surface text-[15px] font-bold active:bg-line"
            >
              증빙 올리기
            </button>
            <span className={hint}>JPG · PNG · WEBP, 5MB 까지.</span>
          </form>
        </section>
      ) : null}

      {!isNew ? (
        <form action={deleteClassAction} className="mt-10 border-t border-line pt-6">
          <input type="hidden" name="slug" value={data.slug} />
          <button type="submit" className="text-[13px] font-semibold text-danger underline underline-offset-2">
            이 반 지우기
          </button>
          <p className={`${hint} mt-1`}>신청이 들어온 반은 지울 수 없어요. 마감으로 바꿔주세요.</p>
        </form>
      ) : null}
    </main>
  );
}
