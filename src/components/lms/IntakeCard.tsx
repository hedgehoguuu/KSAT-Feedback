import type { IntakeSummary } from '@/lib/lms/intake';
import { Card } from './Shell';

/**
 * 9월에 학생이 직접 적어 준 고민. 튜터만 본다.
 *
 * 채점 화면 옆에 두는 이유가 있다 — 이 학생이 '왜' 틀렸는지에 대한 유일한 1인칭 자료다.
 * 점수는 무엇이 무너졌는지까지만 말하고, 그때 현장에서 무엇을 하고 있었는지는 여기에만 있다.
 */
export function IntakeCard({ intake, compact = false }: { intake: IntakeSummary; compact?: boolean }) {
  return (
    <Card title="9월에 적어 준 고민">
      <p className="mb-3 text-[13px] text-muted">
        {intake.examLabel} · 접수번호 {intake.receiptNo} · {intake.createdAt.slice(0, 10)}
        {intake.filesGone ? ' · 시험지 사진은 보관 기간이 지나 지워졌어요' : ''}
      </p>

      {intake.subjects.length === 0 ? (
        <p className="text-[14px] text-muted">그때 적어 준 내용이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {intake.subjects.map((subject) => (
            <div key={subject.code}>
              <p className="mb-1.5 text-[13px] font-extrabold">
                {subject.label}
                {subject.pageCount > 0 ? (
                  <span className="ml-1.5 font-bold text-muted">{subject.pageCount}장</span>
                ) : null}
              </p>
              {subject.concerns.length === 0 ? (
                <p className="text-[13px] text-muted">적어 준 내용 없음</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(compact ? subject.concerns.slice(0, 2) : subject.concerns).map((c, i) => (
                    <li key={i} className="glass-inset rounded-xl p-3">
                      <p className="text-[12px] leading-[1.6] text-muted">{c.question}</p>
                      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.7]">{c.answer}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
