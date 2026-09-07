'use client';

import { useMemo, useState } from 'react';
import { AREAS, AREA_GROUPS, LMS, fmtScore } from '@/config/lms';
import { btn, btnGhost, input } from './Shell';

/**
 * 문항표 편집.
 *
 * 회차마다 한 번만 채우면 그 뒤로 학생별 채점은 O/X 만 찍으면 끝난다.
 * 그래서 여기가 조금 번거로운 대신 반복되는 쪽이 가벼워진다.
 *
 * 칸 이름에 번호를 안 붙이고 같은 이름을 반복해서 쓴다 — FormData.getAll() 이 문서
 * 순서를 지키므로, 줄을 중간에 넣거나 지워도 서버에서 짝이 어긋나지 않는다.
 */

export type QuestionDraft = {
  no: number;
  area_code: string;
  points: number;
  answer: number | null;
  passage: string | null;
};

let nextKey = 0;
type Row = QuestionDraft & { key: number };

export function QuestionTable({
  action,
  examId,
  initial,
}: {
  action: (formData: FormData) => Promise<void>;
  examId: string;
  initial: QuestionDraft[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((r) => ({ ...r, key: nextKey++ })));

  const totalPoints = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.points) || 0), 0), [rows]);

  // 선택과목 두 벌이 다 들어 있으면 배점 합이 만점보다 크게 나온다. 그건 정상이라 따로 말해 준다.
  const electiveCodes = new Set(AREAS.filter((a) => a.elective).map((a) => a.code));
  const bothElectives =
    new Set(rows.filter((r) => electiveCodes.has(r.area_code)).map((r) => r.area_code)).size > 1;

  const patch = (key: number, next: Partial<QuestionDraft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      {
        key: nextKey++,
        // 마지막 줄 다음 번호를 미리 넣어 준다. 대개 그게 맞다.
        no: prev.length ? Math.max(...prev.map((r) => r.no)) + 1 : 1,
        area_code: prev.at(-1)?.area_code ?? AREAS[0].code,
        points: 2,
        answer: null,
        passage: null,
      },
    ]);

  return (
    <form action={action}>
      <input type="hidden" name="exam_id" value={examId} />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted">
          {rows.length}문항 · 배점 합{' '}
          <span className="font-bold text-foreground">{fmtScore(totalPoints)}</span>점
        </p>
        {bothElectives ? (
          <p className="text-[12px] text-muted">
            화작·언매를 함께 넣으면 배점 합이 만점을 넘어요 — 학생은 자기 선택과목만 채점돼요.
          </p>
        ) : !bothElectives && totalPoints !== LMS.fullScore ? (
          <p className="text-[12px] text-mark">만점 {LMS.fullScore}점과 달라요. 배점을 확인해주세요.</p>
        ) : null}
      </div>

      <div className="lms-scroll">
        <table className="lms-table">
          <thead>
            <tr>
              <th className="w-14">번호</th>
              <th className="w-44">영역</th>
              <th className="w-20">배점</th>
              <th className="w-20">정답</th>
              <th>지문 표시</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <input
                    name="no"
                    type="number"
                    min={1}
                    max={LMS.maxQuestionCount}
                    value={row.no}
                    onChange={(e) => patch(row.key, { no: Number(e.target.value) })}
                    className={`${input} w-14 px-2`}
                    aria-label="문항 번호"
                  />
                </td>
                <td>
                  <select
                    name="area_code"
                    value={row.area_code}
                    onChange={(e) => patch(row.key, { area_code: e.target.value })}
                    className={`${input} w-44`}
                    aria-label="영역"
                  >
                    {AREAS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {AREA_GROUPS[a.group]} · {a.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name="points"
                    type="number"
                    min={0}
                    step={0.5}
                    value={row.points}
                    onChange={(e) => patch(row.key, { points: Number(e.target.value) })}
                    className={`${input} w-20 px-2`}
                    aria-label="배점"
                  />
                </td>
                <td>
                  <select
                    name="answer"
                    value={row.answer ?? ''}
                    onChange={(e) => patch(row.key, { answer: e.target.value ? Number(e.target.value) : null })}
                    className={`${input} w-20`}
                    aria-label="정답"
                  >
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    name="passage"
                    value={row.passage ?? ''}
                    onChange={(e) => patch(row.key, { passage: e.target.value })}
                    placeholder="(가)(나) 같은 표시"
                    className={input}
                    aria-label="지문 표시"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    className="text-[13px] font-bold text-muted hover:text-danger"
                    aria-label={`${row.no}번 줄 지우기`}
                  >
                    지움
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={addRow} className={btnGhost}>
          줄 추가
        </button>
        <button type="submit" className={btn}>
          문항표 저장
        </button>
      </div>

      <p className="mt-3 text-[13px] leading-[1.6] text-muted">
        번호를 그대로 두고 영역·배점만 고치면 이미 매긴 O/X 는 그대로 남아요.
        번호를 지우면 그 문항의 채점 결과도 함께 사라져요.
      </p>
    </form>
  );
}
