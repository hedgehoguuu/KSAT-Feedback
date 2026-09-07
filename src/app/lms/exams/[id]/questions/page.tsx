import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuestionTable } from '@/components/lms/QuestionTable';
import { ConfirmSubmit } from '@/components/lms/ConfirmSubmit';
import { Card, Shell, btnGhost, input, label } from '@/components/lms/Shell';
import { ELECTIVES, ELECTIVE_LIST, LMS, layoutSummary } from '@/config/lms';
import { requireRole } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { getExam, listExams, listQuestions } from '@/lib/lms/exams';
import { ocrConfigured } from '@/lib/lms/ocr';
import { copyQuestionsFrom, extractQuestionTable, reseedQuestionTable, saveQuestionTable } from '../../../course-actions';

export const dynamic = 'force-dynamic';

export default async function QuestionTablePage({ params, searchParams }: PageProps<'/lms/exams/[id]/questions'>) {
  const me = await requireRole('tutor', 'admin');
  const { id } = await params;
  const flags = await searchParams;

  const exam = await getExam(id);
  if (!exam) notFound();
  const course = await courseVisibleTo(exam.course_id, me);
  if (!course) notFound();

  const [questions, siblings] = await Promise.all([listQuestions(exam.id), listExams(exam.course_id)]);
  // 문항표가 있는 다른 회차만 베낄 거리가 된다.
  const others = siblings.filter((e) => e.id !== exam.id);

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
      {flags.copied ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px] leading-[1.6]" role="status">
          {flags.copied}줄을 가져왔어요. <span className="font-bold">정답은 가져오지 않았어요</span> —
          회차마다 다르니 직접 넣어주세요.
        </p>
      ) : null}
      {flags.seeded ? (
        <p className="mt-4 rounded-xl bg-mark-soft px-4 py-3 text-[14px] font-bold text-mark" role="status">
          문항표를 새로 깔았어요. 이 회차에 매겨 둔 O/X 는 사라졌어요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <QuestionTable
          action={saveQuestionTable}
          ocrAction={extractQuestionTable}
          ocrConfigured={ocrConfigured()}
          examId={exam.id}
          initial={questions}
        />

        {others.length > 0 ? (
          <Card title="지난 회차에서 가져오기">
            <form action={copyQuestionsFrom} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="exam_id" value={exam.id} />
              <div className="min-w-52 flex-1">
                <label className={label} htmlFor="from_exam_id">어느 회차에서</label>
                <select id="from_exam_id" name="from_exam_id" required className={input} defaultValue="">
                  <option value="" disabled>고르기</option>
                  {others.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                      {e.exam_date ? ` · ${e.exam_date}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <ConfirmSubmit
                className={btnGhost}
                message={`고른 회차의 문항표로 이 회차를 덮어씁니다.\n\n지금 ${questions.length}줄이 있고, 번호나 영역이 달라지는 문항의 O/X 는 사라져요.`}
              >
                가져오기
              </ConfirmSubmit>
            </form>
            <p className="mt-3 text-[13px] leading-[1.6] text-muted">
              같은 형식의 모의고사를 매주 본다면 배점과 영역 배치가 거의 그대로예요.
              <span className="font-bold"> 정답은 가져오지 않아요</span> — 회차마다 반드시 다르고,
              지난 회차 정답이 남아 있으면 고치는 걸 잊었을 때 조용히 틀린 채점이 돼요.
            </p>
          </Card>
        ) : null}

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
            <fieldset>
              <legend className={label}>선택과목</legend>
              {/* 한 반에 화작·언매가 섞여 있는 것이 보통이라 둘 다 켜 둔다.
                  35번부터는 고른 과목마다 한 줄씩 깔린다 — 같은 번호에 두 줄이 맞다. */}
              <div className="flex min-h-10 items-center gap-3">
                {ELECTIVE_LIST.map((e) => (
                  <label key={e} className="flex items-center gap-1.5 text-[14px] font-bold">
                    <input type="checkbox" name="elective" value={e} defaultChecked className="size-4" />
                    {ELECTIVES[e]}
                  </label>
                ))}
              </div>
            </fieldset>
            <ConfirmSubmit
              className={btnGhost}
              message={`문항표를 통상 배치로 덮어씁니다.\n\n지금 ${questions.length}줄이 있고, 이 회차에 매겨 둔 O/X 가 전부 사라져요. 되돌릴 수 없어요.`}
            >
              새로 깔기
            </ConfirmSubmit>
          </form>
          <p className="mt-3 text-[13px] leading-[1.6] text-muted">
            통상 배치({layoutSummary()})로 덮어써요. 35번부터는 고른 선택과목마다 한 줄씩 깔려요 — 같은 번호에 두 줄이 보이는 게 맞아요.
            화작 학생과 언매 학생이 그 번호에서 서로 다른 문항을 풀거든요.
            <span className="font-bold text-mark"> 이미 매긴 O/X 가 전부 사라져요</span> —
            채점을 시작하기 전에만 쓰세요.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
