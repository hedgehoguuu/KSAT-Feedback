import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuestionTable } from '@/components/lms/QuestionTable';
import { Card, Shell, btnGhost, input, label } from '@/components/lms/Shell';
import { ELECTIVES, ELECTIVE_LIST, LMS } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { getExam, listQuestions } from '@/lib/lms/exams';
import { reseedQuestionTable, saveQuestionTable } from '../../../course-actions';

export const dynamic = 'force-dynamic';

export default async function QuestionTablePage({ params, searchParams }: PageProps<'/lms/exams/[id]/questions'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const flags = await searchParams;

  const exam = await getExam(id);
  if (!exam) notFound();
  const course = await courseVisibleTo(exam.course_id, me);
  if (!course) notFound();

  const questions = await listQuestions(exam.id);

  return (
    <Shell user={me}>
      <Link href={`/lms/exams/${exam.id}`} className="text-[13px] font-semibold text-muted underline underline-offset-2">
        ← {exam.title}
      </Link>
      <h1 className="mt-3 text-[20px] font-extrabold">문항표</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        회차마다 한 번만 채우면 돼요. 여기에 영역과 배점이 있어야 학생별 O/X 가 영역 점수로 접혀요.
      </p>

      {flags.new ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          통상 배치로 {questions.length}줄을 미리 깔아 뒀어요. 이번 시험지에 맞게 영역과 배점만 고쳐주세요.
        </p>
      ) : null}
      {flags.saved ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">문항표를 저장했어요.</p>
      ) : null}
      {flags.seeded ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="status">
          문항표를 새로 깔았어요. 이 회차에 매겨 둔 O/X 는 사라졌어요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card>
          <QuestionTable action={saveQuestionTable} examId={exam.id} initial={questions} />
        </Card>

        <Card title="처음부터 다시 깔기">
          <form action={reseedQuestionTable} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="exam_id" value={exam.id} />
            <div>
              <label className={label} htmlFor="count">문항 수</label>
              <input
                id="count"
                name="count"
                type="number"
                min={1}
                max={LMS.maxQuestionCount}
                defaultValue={LMS.defaultQuestionCount}
                className={`${input} w-24`}
              />
            </div>
            <div>
              <label className={label} htmlFor="elective">선택과목</label>
              <select id="elective" name="elective" defaultValue="speech" className={`${input} w-36`}>
                {ELECTIVE_LIST.map((e) => (
                  <option key={e} value={e}>{ELECTIVES[e]}</option>
                ))}
              </select>
            </div>
            <button type="submit" className={btnGhost}>새로 깔기</button>
          </form>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            통상 배치(1–3 독서론 · 4–9 인문 · 10–17 과학기술 · 18–26 현대시 · 27–34 현대소설 · 35– 선택)로
            덮어써요. <span className="font-bold text-mark">이미 매긴 O/X 가 전부 사라져요</span> —
            채점을 시작하기 전에만 쓰세요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
