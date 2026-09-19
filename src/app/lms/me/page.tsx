import Link from 'next/link';
import { Card, Empty, Shell } from '@/components/lms/Shell';
import { StudentReport } from '@/components/lms/StudentReport';
import { SUBJECT } from '@/config/lms';
import { fmtDay, fmtScore } from '@/lib/format';
import { seoulDate } from '@/lib/kst';
import { requireRole } from '@/lib/lms/auth';
import { coursesOfStudent } from '@/lib/lms/courses';
import { examAverages, studentHistory } from '@/lib/lms/exams';
import { studentExams, type StudentExamItem } from '@/lib/lms/lists';

export const dynamic = 'force-dynamic';

export default async function StudentHome({ searchParams }: PageProps<'/lms/me'>) {
  const me = await requireRole('student');
  const { changed } = await searchParams;

  const [courses, exams, history] = await Promise.all([
    coursesOfStudent(me.id),
    studentExams(me.id),
    // 선생님이 다 매겨 저장한 채점만. 매기는 도중의 반쪽짜리 점수가 학생에게 보이면 안 된다.
    studentHistory(me.id, { forStudent: true }),
  ]);
  // 반과 견줄 것은 회차별 반 평균 하나뿐이다 — 한 반이 두세 명이라 그 밖의 것은 곧 친구의 점수다.
  const averages = await examAverages(history.points.map((p) => p.exam.id));
  const scoreByExam = new Map(history.points.map((p) => [p.exam.id, p.score]));
  const today = seoulDate();

  return (
    <Shell user={me}>
      <h1 className="text-[20px] font-extrabold">{me.name} 학생</h1>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">
        {courses.length > 0 ? courses.map((c) => c.name).join(' · ') : '아직 등록된 반이 없어요'} · {SUBJECT.name}(
        {SUBJECT.elective})
      </p>

      {changed ? (
        <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-[14px]" role="status">
          비밀번호를 바꿨어요.
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <Card title="시험">
          {exams.length === 0 ? (
            <Empty>
              아직 열린 시험이 없어요.
              <br />
              시험을 보고 나면 여기에 생겨요. 시험지 사진과 질문을 여기서 올려요.
            </Empty>
          ) : (
            <ul className="glass-divide flex flex-col">
              {exams.map((item) => {
                const score = scoreByExam.get(item.exam.id);
                return (
                  <li key={item.exam.id} className="py-3 first:pt-0">
                    <Link href={`/lms/me/exams/${item.exam.id}`} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold">
                          {item.exam.title}
                          {score?.complete ? (
                            <span className="ml-2 text-[13px] font-bold text-muted">
                              {fmtScore(score.earned)} / {fmtScore(score.total)}점
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[13px] text-muted">
                          {item.exam.exam_date ? `${fmtDay(item.exam.exam_date)} 시험` : '날짜 미정'}
                          {courses.length > 1 ? ` · ${item.course.name}` : ''}
                        </p>
                      </div>
                      <StateChip item={item} today={today} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {history.points.length > 0 ? (
          <StudentReport history={history} hrefFor={(p) => `/lms/me/exams/${p.exam.id}`} examAverages={averages} />
        ) : null}
      </div>

      <p className="mt-6 text-[13px] leading-[1.6] text-muted">
        점수가 이상하거나 안 보이는 시험이 있으면 선생님께 말해주세요.{' '}
        <Link href="/lms/password" className="font-bold text-brand underline underline-offset-2">
          비밀번호 바꾸기
        </Link>
      </p>
    </Shell>
  );
}

/** 이 시험에서 학생이 지금 할 일 — 아무것도 안 했으면 빨갛게, 답이 왔으면 파랗게. */
function StateChip({ item, today }: { item: StudentExamItem; today: string }) {
  const { attempt, counts, exam } = item;
  const base = 'shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold';

  if (attempt?.feedback_ready_at) {
    return <span className={`${base} bg-brand text-white`}>답이 왔어요</span>;
  }
  if (attempt?.submitted_at) {
    return (
      <span className={`${base} bg-brand/10 text-brand`}>
        답을 기다려요{exam.due_date ? ` · ${fmtDay(exam.due_date)}까지` : ''}
      </span>
    );
  }
  if (counts.photos > 0 || counts.concerns > 0) {
    return <span className={`${base} bg-mark-soft text-mark`}>작성 중 · 제출 전</span>;
  }
  const late = Boolean(exam.exam_date && exam.exam_date < today);
  return (
    <span className={`${base} ${late ? 'bg-mark-soft text-mark' : 'bg-surface text-muted'}`}>
      사진·질문 올리기
    </span>
  );
}
