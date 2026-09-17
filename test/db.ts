/**
 * 진짜 DB 에 붙여 수업 한 회차를 통째로 돌리는 시험. `npm run test:db` 가 이걸 돌린다.
 *
 * 순수 계산(test/logic.ts)만으로는 못 잡는 것들이 있다 — 제약이 실제로 거는가,
 * 연쇄 삭제가 도는가, 못 읽었을 때 조용히 빈 목록이 되지 않는가, 저장소 파일이 줄과
 * 함께 지워지는가. 그건 붙여 봐야 안다. 실제로 이 시험을 만들다가 채점이 통째로
 * 사라지는 버그를 찾았다 (0012).
 *
 * ── 돌리기 전에
 * 이 시험은 LMS 표를 **비우고** lms-files 버킷의 파일을 지운다. 운영 DB 에 붙이면
 * 학생 성적과 시험지 사진이 전부 사라진다. 그래서 평소 환경변수(SUPABASE_URL)를 쓰지 않고
 * 일부러 다른 이름을 본다.
 *
 *   TEST_SUPABASE_URL=...            버릴 수 있는 Supabase 프로젝트
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *
 * 무료 프로젝트를 하나 더 만들어 마이그레이션만 돌려 두고 쓰면 된다.
 * 메일 환경변수(GMAIL_*)는 지우고 돈다 — 시험이 학생에게 진짜 메일을 보내면 안 된다.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { section, ok, eq, done } from './assert.ts';

/* ─────────────────────────────────────────────── 운영 DB 를 지우지 않게 */

const url = process.env.TEST_SUPABASE_URL;
const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log(`
  이 시험은 진짜 DB 가 필요하고, 붙은 DB 의 LMS 표와 lms-files 버킷을 **비운다**.

    TEST_SUPABASE_URL=https://xxxx.supabase.co \\
    TEST_SUPABASE_SERVICE_ROLE_KEY=... \\
    npm run test:db

  버려도 되는 Supabase 프로젝트를 하나 만들어 supabase/migrations 를 번호 순서대로
  돌려 둔 뒤 그 주소를 넣는다. 운영 프로젝트를 넣지 않는다.
`);
  process.exit(0);
}

/**
 * 실수로 운영 DB 를 넣었을 때 막는다. 평소 쓰는 값과 같으면 그건 운영이다.
 * 이름을 달리 둔 것만으로는 부족하다 — .env 를 통째로 불러 놓고 돌리는 일이 실제로 생긴다.
 */
if (url === process.env.SUPABASE_URL || url === process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('\n  TEST_SUPABASE_URL 이 평소 쓰는 SUPABASE_URL 과 같습니다. 운영 DB 로 보입니다 — 멈춥니다.\n');
  process.exit(1);
}

// 앱 코드가 보는 이름으로 옮겨 담는다. 여기서만 한다.
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;

const { createUser, findForLogin, getStudent, listStudents, listUsers, resetPassword,
        tryUserCount, updateUser, deleteUser, upsertStudentProfile } = await import('../src/lib/lms/users.ts');
const { saveCourse, listCourses, enroll, listEnrolled, courseVisibleTo, studentVisibleTo,
        unenroll, isEnrolled, deleteCourse } = await import('../src/lib/lms/courses.ts');
const { saveExam, listExams, listQuestions, saveAnswerKey, seedQuestions, openAttempt, findAttempt,
        saveGrading, loadGrading, examBoard, courseSummary, studentHistory,
        publishGradedAttempts, listAnswers, deleteExam, getAttempt } = await import('../src/lib/lms/exams.ts');
const { addPhoto, listPhotos, movePhoto, removePhoto, saveConcerns, listConcerns, saveConcernAnswers,
        setAnswerImage, clearAnswerImage, sendFeedback, feedbackPdfOf, pendingFeedback,
        studentExams, cleanConcerns } = await import('../src/lib/lms/feedback.ts');
const { LMS_BUCKET, getFile } = await import('../src/lib/lms/files.ts');
const { verifyPassword } = await import('../src/lib/lms/password.ts');
const { db } = await import('../src/lib/lms/db.ts');
const { PAPER, PHOTO_READ } = await import('../src/config/lms.ts');
const { requestPhotoRead, runPhotoRead, getPhotoRead, applyPhotoRead, ensurePhotoRead, retryPhotoReads } =
  await import('../src/lib/lms/photo-read.ts');
const { readViewOf } = await import('../src/lib/lms/photo-read-state.ts');

/* ─────────────────────────────────────────────────────────── 비우기 */

// 저장소부터. 줄을 먼저 지우면 어떤 파일이 있었는지 알 길이 없다.
async function wipeBucket(prefix = 'attempts'): Promise<void> {
  const { data } = await db().storage.from(LMS_BUCKET).list(prefix, { limit: 1000 });
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    // 폴더는 id 가 없다. 안으로 들어간다.
    if (!entry.id) await wipeBucket(path);
    else await db().storage.from(LMS_BUCKET).remove([path]);
  }
}
await wipeBucket();

// 사람을 지우면 반·회차·응시·정오·질문이 연쇄로 따라 사라진다 (0008 · 0015 의 on delete cascade).
for (const table of ['lms_concerns', 'lms_photo_reads', 'lms_attempt_photos', 'lms_answers', 'lms_attempts', 'lms_exam_questions',
                     'lms_exams', 'lms_enrollments', 'lms_courses', 'lms_students', 'lms_users']) {
  const { error } = await db().from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  // 기본키가 id 가 아닌 표(정오·수강·학생)는 위가 안 먹으므로 한 번 더 넓게 지운다.
  if (error) {
    await db().from(table).delete().gte('attempt_id', '00000000-0000-0000-0000-000000000000');
    await db().from(table).delete().gte('course_id', '00000000-0000-0000-0000-000000000000');
    await db().from(table).delete().gte('user_id', '00000000-0000-0000-0000-000000000000');
  }
}

/* ═══════════════════════════════════════════════════════════ 시작 */

const id = (r: unknown) => (r as { id: string }).id;
const KEY = [3, 5, 2, 4, 1, 2, 3, 5, 1, 4, 3, 2, 5, 4, 1, 12, 7, 24, 5, 31, 17, 58, 2, 4, 1, 3, 5, 2, 16, 125];
// 8×8 짜리 JPEG. 사진 경로 · 저장 · 삭제 · PDF 에 박히는지를 보려는 것이라 그림은 상관없다.
const JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6VooooA//2Q==',
  'base64',
));

async function fileExists(path: string): Promise<boolean> {
  try {
    await getFile(path);
    return true;
  } catch {
    return false;
  }
}

section('1. 계정');
ok('처음엔 계정이 0명', (await tryUserCount()) === 0, String(await tryUserCount()));

const adminId = id(await createUser({ role: 'admin', login_id: 'boss', password: 'admin-pass-1', name: '주현' }));
ok('첫 관리자가 만들어진다', Boolean(adminId));
eq('대소문자만 다른 아이디는 거절',
  await createUser({ role: 'tutor', login_id: 'BOSS', password: 'x'.repeat(8), name: '남' }), 'DUPLICATE_ID');

const tutorId = id(await createUser({ role: 'tutor', login_id: 'seohyun', password: 'tutor-pass-1', name: '서현', email: 'tutor@example.com' }));
const students: { id: string; name: string }[] = [];
for (const [name, login, email] of [['가영', 'gayoung', 'gy@example.com'], ['나은', 'naeun', null], ['다희', 'dahee', null]] as const) {
  students.push({
    id: id(await createUser({ role: 'student', login_id: login, password: 'student-pass', name, email,
      student: { grade: 3, school: '인천고', parent_phone: '010-0000-0000' } })),
    name,
  });
}
eq('관리자 1 + 튜터 1 + 학생 3', await tryUserCount(), 5);

section('2. 로그인');
const found = await findForLogin('BOSS');
ok('대문자로 쳐도 찾는다', found?.name === '주현');
ok('맞는 비밀번호는 통과', verifyPassword('admin-pass-1', found!.password_hash));
ok('틀린 비밀번호는 거절', !verifyPassword('admin-pass-2', found!.password_hash));
ok('처음엔 비밀번호를 바꿔야 한다', found!.must_change_password);
await resetPassword(adminId, 'new-admin-pass');
ok('재발급이 실제로 반영된다', verifyPassword('new-admin-pass', (await findForLogin('boss'))!.password_hash));

section('3. 학생 정보');
const prof = await getStudent(students[0].id);
ok('학년·학교·메일이 저장된다',
  prof?.profile?.grade === 3 && prof?.profile?.school === '인천고' && prof?.email === 'gy@example.com');
ok('목록에 프로필이 붙어 온다', (await listStudents()).every((s) => s.profile !== null));
eq('튜터는 1명', (await listUsers('tutor')).length, 1);

section('4. 반과 수강');
const courseId = await saveCourse({ name: '목19 수학', tutor_id: tutorId, class_id: null, status: 'active', memo: null });
for (const s of students) await enroll(courseId, s.id);
await enroll(courseId, students[0].id);
eq('두 번 넣어도 한 줄', (await listEnrolled(courseId)).length, 3);

const cards = await listCourses(tutorId);
eq('반 목록에 학생 수가 센다', cards[0]?.studentCount, 3);
eq('담당 튜터 이름이 붙는다', cards[0]?.tutorName, '서현');
ok('튜터는 자기 반을 본다', (await courseVisibleTo(courseId, { id: tutorId, role: 'tutor' })) !== null);
ok('남의 반은 못 본다', (await courseVisibleTo(courseId, { id: students[0].id, role: 'tutor' })) === null);
ok('관리자는 다 본다', (await courseVisibleTo(courseId, { id: adminId, role: 'admin' })) !== null);
ok('튜터는 자기 반 학생만', await studentVisibleTo(students[0].id, { id: tutorId, role: 'tutor' }));
ok('남의 반 학생은 아니다', !(await studentVisibleTo(students[0].id, { id: adminId, role: 'tutor' })));

// 튜터가 관리자 id 를 자기 반에 넣고 '학생 비밀번호 재발급' 으로 관리자 비밀번호를 바꾸던 길
eq('관리자 계정은 반에 못 넣는다', await enroll(courseId, adminId), 'NOT_STUDENT');
ok('관리자 계정은 튜터에게 학생으로 안 잡힌다', !(await studentVisibleTo(adminId, { id: tutorId, role: 'tutor' })));
eq('학생 전용 재발급은 관리자 계정을 못 바꾼다',
  await resetPassword(adminId, 'hijacked-pass', { studentOnly: true }), false);
ok('관리자 비밀번호가 그대로', verifyPassword('new-admin-pass', (await findForLogin('boss'))!.password_hash));
ok('수강생은 명단에 있다', await isEnrolled(courseId, students[0].id));
ok('관리자는 명단에 없다 (채점을 못 연다)', !(await isEnrolled(courseId, adminId)));

section('5. 회차와 정답표');
const examId = await saveExam({ course_id: courseId, title: '1주차', exam_date: '2026-09-17', due_date: '2026-09-24', status: 'draft' });
const blank = await listQuestions(examId);
eq('만들자마자 1–30번이 깔린다', blank.map((q) => q.no), PAPER.map((q) => q.no));
eq('배점 합 100', blank.reduce((s, q) => s + q.points, 0), 100);
ok('배점이 숫자로 온다 (numeric 문자열 아님)', typeof blank[0].points === 'number');
ok('정답은 비어 있다', blank.every((q) => q.answer === null));
await seedQuestions(examId);
eq('다시 깔아도 30줄', (await listQuestions(examId)).length, 30);

eq('처음 저장은 다시 매길 것이 없다',
  await saveAnswerKey(examId, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: q.no === 12 ? 'm1_seq' : null }))), 0);
const qs = await listQuestions(examId);
eq('정답이 들어간다', qs.map((q) => q.answer), KEY);
eq('단원이 들어간다', qs.find((q) => q.no === 12)?.unit_code, 'm1_seq');
let badKey = false;
try {
  await db().from('lms_exam_questions').update({ answer: 1000 }).eq('id', qs[15].id).then(({ error }) => { if (error) throw error; });
} catch { badKey = true; }
ok('단답형 1000 은 DB 가 막는다', badKey);
let dupNo = false;
try {
  await db().from('lms_exam_questions').insert({ exam_id: examId, no: 5, points: 3 }).then(({ error }) => { if (error) throw error; });
} catch { dupNo = true; }
ok('같은 번호 두 줄은 DB 가 막는다', dupNo);

section('6. 채점');
const attempt = await openAttempt(examId, students[0].id);
eq('두 번 열어도 같은 응시', (await openAttempt(examId, students[0].id)).id, attempt.id);

const wrongNos = new Set([12, 21]);
await saveGrading({
  attemptId: attempt.id,
  answers: qs.map((q) => ({
    question_id: q.id,
    correct: !wrongNos.has(q.no),
    chosen: q.no === 12 ? 4 : q.no === 21 ? 71 : q.answer,
  })),
  overallComment: '4점에서 방향을 늦게 잡았어요', status: 'draft',
});
const graded = (await loadGrading(attempt.id))!;
eq('만점 100', graded.score.total, 100);
eq('4점 두 개 틀려 92점', graded.score.earned, 92);
ok('채점 완료로 잡힌다', graded.score.complete);
eq('공통 66 · 미적분 26', graded.score.sections.map((s) => s.earned), [66, 26]);
eq('틀린 문항', graded.score.wrongNos, [12, 21]);
eq('단원 붙인 문항만 단원 칸에', graded.score.units.map((u) => [u.code, u.correct, u.count]), [['m1_seq', 0, 1]]);
ok('총평이 돌아온다', graded.attempt.overall_comment?.includes('방향') === true);
ok('단답형 학생 답(71)이 저장된다', (await listAnswers(attempt.id)).some((a) => a.chosen === 71));

section('7. 채점 저장은 한 덩어리여야 한다 (0012 · 0015)');
// 다른 회차의 문항 id 를 섞으면 함수 안에서 delete 다음에 터진다 — 예전에 채점이 날아가던 지점이다.
const otherExam = await saveExam({ course_id: courseId, title: '다른 회차', exam_date: null, due_date: null, status: 'draft' });
const foreign = (await listQuestions(otherExam))[0].id;
let threw = false;
try {
  await saveGrading({
    attemptId: attempt.id,
    answers: [...graded.answers, { question_id: foreign, correct: true, chosen: null }],
    overallComment: '들어가면 안 되는 총평', status: 'published',
  });
} catch { threw = true; }
ok('다른 회차 문항이 섞이면 던진다 (화면이 거짓말 안 함)', threw);
const afterFail = (await loadGrading(attempt.id))!;
eq('점수가 그대로', afterFail.score.earned, 92);
eq('정오가 그대로', (await listAnswers(attempt.id)).length, 30);
eq('총평이 안 덮였다', afterFail.attempt.overall_comment, graded.attempt.overall_comment);
eq('공개 상태가 안 바뀌었다', afterFail.attempt.status, 'draft');
await deleteExam(otherExam);

section('8. 정답을 고치면 적어 둔 학생 답으로 다시 매긴다');
eq('12번 정답을 4로 고치면 한 명 다시 매김',
  await saveAnswerKey(examId, PAPER.map((q) => ({ no: q.no, answer: q.no === 12 ? 4 : KEY[q.no - 1], unit_code: q.no === 12 ? 'm1_seq' : null }))), 1);
eq('12번이 맞음으로 바뀌어 96점', (await loadGrading(attempt.id))!.score.earned, 96);
await saveAnswerKey(examId, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: q.no === 12 ? 'm1_seq' : null })));
eq('되돌리면 다시 92점', (await loadGrading(attempt.id))!.score.earned, 92);

// 나은이는 O/X 만 찍었다 — 학생 답이 없어서 정답을 고쳐도 그대로다.
const a2 = await openAttempt(examId, students[1].id);
await saveGrading({ attemptId: a2.id,
  answers: qs.map((q) => ({ question_id: q.id, correct: q.no !== 30, chosen: null })),
  overallComment: null, status: 'draft' });
eq('나은 96점', (await loadGrading(a2.id))!.score.earned, 96);

section('9. 반 비교');
const exam = (await listExams(courseId))[0];
const board = await examBoard(exam);
eq('명단에 3명 (미채점 포함)', board.rows.length, 3);
eq('채점 끝난 2명만 평균에', board.stats.counted, 2);
eq('평균 94점', board.stats.average, 94);
eq('1등은 나은', board.stats.standings[0].name, '나은');
eq('미채점 학생은 석차 없음', board.stats.standings.find((s) => s.name === '다희')?.rank, 0);
eq('가영은 평균 -2점', board.stats.standings.find((s) => s.name === '가영')?.vsAverage, -2);
ok('배점 칸 반 평균이 있다', board.stats.partAverages.has('p4'));

section('10. 일괄 공개 — 채점 끝난 것만');
const res = await publishGradedAttempts(exam);
eq('2명 공개', res.published, 2);
eq('미채점 1명은 남는다', res.skipped, 1);
eq('다시 눌러도 새로 공개할 게 없다', (await publishGradedAttempts(exam)).published, 0);

section('11. 학생이 보는 것');
eq('회차가 준비 중이면 점수를 공개해도 안 보인다',
  (await studentHistory(students[0].id, { publishedOnly: true })).points.length, 0);
eq('준비 중인 회차는 학생 시험 목록에도 없다', (await studentExams(students[0].id)).length, 0);
await saveExam({ id: examId, course_id: courseId, title: '1주차', exam_date: '2026-09-17', due_date: '2026-09-24', status: 'published' });
const hist = await studentHistory(students[0].id, { publishedOnly: true });
eq('공개된 회차가 보인다', hist.points.length, 1);
eq('점수가 맞는다', hist.points[0].score.earned, 92);
eq('누적 단원 칸', hist.trends.units.map((t) => t.code), ['m1_seq']);
eq('채점 안 끝난 학생에겐 점수가 없다', (await studentHistory(students[2].id, { publishedOnly: true })).points.length, 0);
eq('열린 회차는 학생 시험 목록에 뜬다', (await studentExams(students[2].id)).map((e) => e.exam.title), ['1주차']);

section('12. 시험지 사진');
const p1 = await addPhoto(attempt.id, JPEG);
const p2 = await addPhoto(attempt.id, JPEG);
ok('사진 두 장', p1 !== 'TOO_MANY' && p2 !== 'TOO_MANY');
const photo1 = p1 as Exclude<typeof p1, 'TOO_MANY'>;
const photo2 = p2 as Exclude<typeof p2, 'TOO_MANY'>;
ok('저장소에 파일이 있다', await fileExists(photo1.storage_path));
ok('다른 학생 응시로는 못 지운다', !(await removePhoto(a2.id, photo1.id)));
await movePhoto(attempt.id, photo2.id, -1);
eq('순서를 바꾼다', (await listPhotos(attempt.id)).map((p) => p.id), [photo2.id, photo1.id]);
ok('지우면 줄이 사라진다', await removePhoto(attempt.id, photo2.id));
ok('파일도 사라진다', !(await fileExists(photo2.storage_path)));
eq('한 장 남는다', (await listPhotos(attempt.id)).length, 1);

section('13. 학생 질문');
const drafts = cleanConcerns([
  { question_no: 21, body: '그래프 개형을 못 떠올렸어요' },
  { question_no: 0, body: '시간이 모자랐어요' },
]);
eq('제출 전 저장', await saveConcerns(attempt.id, drafts.drafts, false), 'OK');
eq('질문 2개 · 시험 전체는 맨 뒤', (await listConcerns(attempt.id)).map((c) => c.question_no), [21, 0]);
eq('제출 전에는 튜터 할 일에 없다', (await pendingFeedback([courseId])).length, 0);
await saveConcerns(attempt.id, cleanConcerns([
  { question_no: 21, body: '그래프 개형을 못 떠올렸어요' },
  { question_no: 12, body: '수열 규칙' },
  { question_no: 0, body: '시간이 모자랐어요' },
]).drafts, true);
ok('제출 시각이 찍힌다', Boolean((await getAttempt(attempt.id))!.submitted_at));
const pending = await pendingFeedback([courseId]);
eq('튜터 할 일에 오른다', pending.map((p) => [p.studentName, p.counts.concerns, p.counts.answered, p.counts.photos]), [['가영', 3, 0, 1]]);

section('14. 답을 달고 보내기');
const concerns = await listConcerns(attempt.id);
const byNo = (no: number) => concerns.find((c) => c.question_no === no)!;
eq('답 하나 저장', await saveConcernAnswers(attempt.id, [{ id: byNo(21).id, answer: '극값부터 찍어요' }]), 1);
eq('다 안 달았으면 안 보낸다', (await sendFeedback(attempt.id)), { ok: false, reason: 'UNANSWERED', missing: [12, 0] });
ok('보내지 않았으니 PDF 도 없다', (await feedbackPdfOf((await getAttempt(attempt.id))!)) === null);

// 답 달린 질문은 학생이 못 고친다
await saveConcerns(attempt.id, [{ question_no: 21, body: '바꿔 보기' }, { question_no: 12, body: '수열 규칙' }, { question_no: 0, body: '시간이 모자랐어요' }], true);
eq('답 달린 21번 질문은 그대로', (await listConcerns(attempt.id)).find((c) => c.question_no === 21)?.body, '그래프 개형을 못 떠올렸어요');

eq('풀이 사진만 붙여도 답이다', await setAnswerImage(attempt.id, byNo(12).id, JPEG), 'OK');
eq('남의 응시 질문에는 못 붙인다', await setAnswerImage(a2.id, byNo(12).id, JPEG), 'NOT_FOUND');
await saveConcernAnswers(attempt.id, [{ id: byNo(0).id, answer: '1–20번에 45분' }]);

const sent = await sendFeedback(attempt.id);
eq('다 달았으면 보낸다 (메일 설정이 없으니 메일은 안 감)', sent, { ok: true, mail: { status: 'NOT_CONFIGURED' }, published: false });
const afterSend = (await getAttempt(attempt.id))!;
ok('보낸 시각과 PDF 경로가 적힌다', Boolean(afterSend.feedback_ready_at && afterSend.feedback_path));
eq('메일이 안 간 이유가 적힌다', afterSend.mail_error, 'NOT_CONFIGURED');
const pdf = await feedbackPdfOf(afterSend);
eq('학생이 받을 PDF', pdf ? Buffer.from(pdf.slice(0, 5)).toString() : null, '%PDF-');
eq('보낸 뒤 학생 쪽은 잠긴다', await saveConcerns(attempt.id, [], true), 'LOCKED');
eq('잠긴 질문은 그대로 3개', (await listConcerns(attempt.id)).length, 3);
eq('튜터 할 일에서 빠진다', (await pendingFeedback([courseId])).length, 0);
const mine = (await studentExams(students[0].id))[0];
ok('학생 목록에 답 도착이 보인다', Boolean(mine.attempt?.feedback_ready_at) && mine.counts.answered === 3);

section('15. 고쳐서 다시 보내기');
await clearAnswerImage(attempt.id, byNo(12).id);
eq('사진을 떼면 다시 안 단 질문이 된다', (await sendFeedback(attempt.id)), { ok: false, reason: 'UNANSWERED', missing: [12] });
await saveConcernAnswers(attempt.id, [{ id: byNo(12).id, answer: '홀짝이 바뀌는 곳만 보세요' }]);
const resent = await sendFeedback(attempt.id);
ok('다시 보낸다', resent.ok);
const afterResend = (await getAttempt(attempt.id))!;
ok('새 PDF 경로', afterResend.feedback_path !== afterSend.feedback_path);
ok('지난 PDF 는 지워진다', !(await fileExists(afterSend.feedback_path!)));

// 다희: 채점이 끝난 뒤 보내면 점수도 함께 열린다
const a3 = await openAttempt(examId, students[2].id);
await saveGrading({ attemptId: a3.id, answers: qs.map((q) => ({ question_id: q.id, correct: true, chosen: q.answer })),
  overallComment: null, status: 'draft' });
await saveConcerns(a3.id, [{ question_no: 30, body: '맞았지만 불안했어요' }], true);
await saveConcernAnswers(a3.id, [{ id: (await listConcerns(a3.id))[0].id, answer: '풀이가 맞아요' }]);
const withScore = await sendFeedback(a3.id);
eq('채점이 끝났으면 보내면서 점수를 연다', withScore.ok && withScore.published, true);
eq('다희 학생 화면에 점수', (await studentHistory(students[2].id, { publishedOnly: true })).points[0]?.score.earned, 100);
eq('질문이 없으면 보낼 것이 없다', await sendFeedback(a2.id), { ok: false, reason: 'NO_CONCERNS' });

section('16. 반 누적');
const exam2 = await saveExam({ course_id: courseId, title: '2주차', exam_date: '2026-09-24', due_date: null, status: 'draft' });
const summary = await courseSummary(courseId);
eq('회차 2개', summary.exams.length, 2);
eq('학생 3명', summary.rows.length, 3);
const gy = summary.rows.find((r) => r.student.name === '가영')!;
eq('평균이 100점 환산으로 나온다', gy.average, 92);
eq('본 회차 1개', gy.taken, 1);
ok('배점 칸 누적', gy.trends.byPoints.some((t) => t.code === 'p4'));

section('17. 지우면 함께 사라지나');
const kept = (await listPhotos(attempt.id))[0];
await unenroll(courseId, students[1].id);
ok('반에서 빼도 계정은 남는다', (await getStudent(students[1].id)) !== null);
eq('수강생이 2명', (await listEnrolled(courseId)).length, 2);
eq('반을 맡은 튜터는 못 지운다', await deleteUser(tutorId), 'IN_USE');
const a3Pdf = (await getAttempt(a3.id))!.feedback_path!;
await deleteUser(students[2].id);
eq('학생을 지우면 응시도 사라진다',
  (await studentHistory(students[2].id, { publishedOnly: false })).points.length, 0);
ok('그 학생의 답변 PDF 도 저장소에서 사라진다', !(await fileExists(a3Pdf)));
eq('남은 학생 성적은 그대로', (await loadGrading(attempt.id))!.score.earned, 92);
await deleteExam(exam2);
eq('회차를 지우면 그 문항표도', (await listQuestions(exam2)).length, 0);

section('18. 프로필을 고쳐도 지난 채점은 그대로');
await upsertStudentProfile(students[0].id, { grade: 2, school: '인천고', parent_phone: null, receipt_no: 'F0902-013', memo: null });
eq('학년이 바뀐다', (await getStudent(students[0].id))!.profile!.grade, 2);
eq('점수는 그대로', (await loadGrading(attempt.id))!.score.earned, 92);
await updateUser(students[0].id, { status: 'suspended' });
eq('정지시킬 수 있다', (await listStudents()).find((s) => s.id === students[0].id)?.status, 'suspended');

section('19. 다른 튜터 반의 채점은 딸려 오지 않는다');
const tutor2 = id(await createUser({ role: 'tutor', login_id: 'tutor-two', password: 'tutor-pass-2', name: '둘째' }));
const course2 = await saveCourse({ name: '특강', tutor_id: tutor2, class_id: null, status: 'active', memo: null });
await enroll(course2, students[0].id);
const exam3 = await saveExam({ course_id: course2, title: '특강 1회', exam_date: '2026-09-20', due_date: null, status: 'draft' });
const a4 = await openAttempt(exam3, students[0].id);
await saveGrading({ attemptId: a4.id, answers: [], overallComment: '비공개 총평', status: 'draft' });
const firstTutorView = await studentHistory(students[0].id, { publishedOnly: false, courseIds: [courseId] });
ok('첫 튜터에게는 자기 반 회차만', firstTutorView.points.every((p) => p.exam.course_id === courseId));
ok('특강 회차는 안 온다', !firstTutorView.points.some((p) => p.exam.id === exam3));
ok('관리자(반 제한 없음)는 둘 다 본다',
  (await studentHistory(students[0].id, { publishedOnly: false })).points.some((p) => p.exam.id === exam3));
ok('특강 튜터의 할 일에 첫 반 제출이 안 섞인다', (await pendingFeedback([course2])).length === 0);

section('20. 반을 지우면 사진까지');
ok('남은 사진 파일이 있다', await fileExists(kept.storage_path));
await deleteCourse(courseId);
ok('반을 지우면 시험지 사진도 사라진다', !(await fileExists(kept.storage_path)));
ok('응시도 사라진다', (await findAttempt(examId, students[0].id)) === null);

/* ═══════════════════════════════════════════ 사진으로 자동 채점 (0016) */

// 모델은 가짜다 — 이 시험이 돈을 쓰거나 밖으로 나가면 안 된다. 요청 모양과 흐름만 본다.
// 사진 몇 번째부터 몇 장을 받았는지(offset · count)에 따라 답을 정한다.
type ModelReply =
  | { kind: 'read'; answers: { no: number; answer: number | null; sure: boolean; note: string | null }[]; unreadable?: number[] }
  | { kind: 'refuse' }
  | { kind: 'status'; status: number; headers?: Record<string, string> }
  | { kind: 'hang' };
let replyFor: (offset: number, count: number) => ModelReply = () => ({ kind: 'read', answers: [] });
const modelCalls: { offset: number; count: number; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
const model = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const content = body.messages[0].content as { type: string; text?: string }[];
  const count = content.filter((c) => c.type === 'image').length;
  const label = content.find((c) => c.type === 'text' && /(\d+)번째/.test(c.text ?? ''));
  const offset = label ? Number(/(\d+)번째/.exec(label.text!)![1]) - 1 : 0;
  modelCalls.push({ offset, count, body, headers: req.headers });

  const reply = replyFor(offset, count);
  if (reply.kind === 'hang') return;
  if (reply.kind === 'status') {
    res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
    res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
    return;
  }
  const base = { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  const message = reply.kind === 'refuse'
    ? { ...base, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }
    : { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answers: reply.answers, unreadable_photos: reply.unreadable ?? [], note: '가짜 모델' }) }] };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(message));
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// 뒤에서 도는 일을 줄 세워 두고 시험이 하나씩 돌린다 (앱에서는 after() 가 돌린다).
const later: (() => Promise<unknown>)[] = [];
const hold = (task: () => Promise<unknown>) => { later.push(task); };
const runNext = async () => await later.shift()!();
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sure = (nos: number[]) => nos.map((no) => ({ no, answer: KEY[no - 1], sure: true, note: null }));
const photoIdsOf = async (attemptId: string) => (await listPhotos(attemptId)).map((p) => p.id);
const gradingOf = async (attemptId: string) => (await loadGrading(attemptId))!;
const noOfQ = async (examId_: string) => new Map((await listQuestions(examId_)).map((q) => [q.id, q.no]));

// 첫 시험지: 앞 네 장에 1–15번, 다섯째 장에 16–30번. 다섯째 장은 흐리다고 한다.
const firstPaper = (offset: number): ModelReply => offset === 0
  ? { kind: 'read', answers: [...sure(span(1, 15)).filter((a) => a.no !== 12), { no: 12, answer: 2, sure: false, note: '②와 ③ 둘 다 표시' }] }
  : { kind: 'read', unreadable: [1], answers: [
      { no: 5, answer: 4, sure: true, note: null },                  // 앞 장에서는 1 — 엇갈린다
      { no: 16, answer: 99, sure: true, note: null },                // 틀린 답
      ...sure(span(17, 20)),
      { no: 21, answer: null, sure: true, note: null },              // 확실한 빈칸
      { no: 22, answer: null, sure: false, note: '흐림' },
      ...sure(span(23, 29)),
      { no: 30, answer: 125, sure: true, note: null },               // 이 회차는 아직 30번 정답이 없다
    ] };
const wholePaper: ModelReply = { kind: 'read', answers: sure(span(1, 30)) };

section('21. 사진으로 자동 채점 — 확실한 것만 매긴다 (0016)');
await enroll(course2, students[1].id);
const exam5 = await saveExam({ course_id: course2, title: '특강 2회', exam_date: '2026-09-21', due_date: null, status: 'published' });
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: q.no === 30 ? null : KEY[q.no - 1], unit_code: null })));
const r1 = await openAttempt(exam5, students[0].id);
for (let i = 0; i < 5; i += 1) await addPhoto(r1.id, JPEG);
replyFor = firstPaper;

eq('학생 쪽에서 부른다', await requestPhotoRead(r1.id, { by: 'student', delayMs: 0, schedule: hold }), 'QUEUED');
eq('기다림으로 적힌다', (await getPhotoRead(r1.id))?.status, 'pending');
eq('읽기 한 판', await runNext(), 'DONE');
eq('사진 다섯 장은 요청 두 번 (넷 + 하나)', modelCalls.map((c) => [c.offset, c.count]), [[0, 4], [4, 1]]);
const firstCall = modelCalls[0];
eq('요청 모양 — 모델 · 거절 대비 · 생각 · 구조화 출력',
  [firstCall.body.model, firstCall.body.fallbacks, (firstCall.body.thinking as { type: string }).type,
   (firstCall.body.output_config as { effort: string; format: { type: string } }).effort,
   (firstCall.body.output_config as { format: { type: string } }).format.type],
  ['claude-opus-5', 'default', 'adaptive', 'medium', 'json_schema']);
ok('거절 대비 베타 머리글', String(firstCall.headers['anthropic-beta'] ?? '').includes('server-side-fallback-2026-07-01'));
const read1 = (await getPhotoRead(r1.id))!;
eq('다 읽었고 모델은 한 판', [read1.status, read1.runs], ['done', 1]);
eq('흐린 사진은 다섯째 장', read1.unreadable, [(await photoIdsOf(r1.id))[4]]);
const g1 = await gradingOf(r1.id);
eq('사진으로 채운 채점', g1.attempt.answers_source, 'photo');
eq('확실하고 정답이 있는 26문항만 매긴다', g1.score.graded, 26);
eq('틀린 것은 16번(99) · 21번(빈칸)', g1.score.wrongNos, [16, 21]);
const nos5 = await noOfQ(exam5);
const markedNos = g1.answers.map((a) => nos5.get(a.question_id)).sort((a, b) => a! - b!);
ok('애매한 12 · 엇갈린 5 · 흐린 22 · 정답 없는 30 은 비운다', [5, 12, 22, 30].every((n) => !markedNos.includes(n)), markedNos);
eq('학생 답도 적힌다 (1번 3 · 21번 빈칸)',
  [1, 21].map((n) => g1.answers.find((a) => nos5.get(a.question_id) === n)?.chosen), [3, null]);
eq('아직 비공개', g1.attempt.status, 'draft');

section('22. 사진이 바뀌면 옛 사진의 채점은 그 자리에서 사라진다');
await addPhoto(r1.id, JPEG);
const g2 = await gradingOf(r1.id);
eq('사진을 더하면 사진 채점이 비워진다', [g2.score.graded, g2.attempt.answers_source], [0, null]);
const staleView = readViewOf(await getPhotoRead(r1.id), await photoIdsOf(r1.id));
ok('읽기는 낡은 것으로 보인다', staleView.kind === 'done' && staleView.stale);
eq('낡은 읽기는 옮기지 않는다', await applyPhotoRead(r1.id, false), -1);
eq('튜터가 눌러도 낡은 읽기는 안 옮긴다', await applyPhotoRead(r1.id, true), -1);
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: null })));
eq('정답표를 고쳐도 낡은 읽기로 채우지 않는다', (await gradingOf(r1.id)).score.graded, 0);

eq('다시 부른다', await requestPhotoRead(r1.id, { by: 'student', delayMs: 0, schedule: hold }), 'QUEUED');
eq('다시 읽는다', await runNext(), 'DONE');
eq('새 사진까지 읽어 채운다 (30번 정답이 생겨 27문항)', (await gradingOf(r1.id)).score.graded, 27);

section('23. 늦게 끝난 옛 읽기는 버린다');
const callsBefore = modelCalls.length;
await requestPhotoRead(r1.id, { by: 'student', delayMs: 0, schedule: hold });
await requestPhotoRead(r1.id, { by: 'student', delayMs: 0, schedule: hold });
eq('앞의 읽기는 시작도 안 한다', await runNext(), 'SKIPPED');
eq('뒤의 읽기가 돈다', await runNext(), 'DONE');
eq('모델은 뒤의 읽기만 불렀다 (요청 두 번)', modelCalls.length - callsBefore, 2);

// 읽는 도중 사진이 바뀐다: 시작한 뒤 한 장을 지우고, 옛 사진 목록으로 마친다.
const before = await photoIdsOf(r1.id);
const { data: reqC } = await db().rpc('request_photo_read', { payload: { attempt_id: r1.id, max_runs: null } });
eq('시작', (await db().rpc('claim_photo_read', { payload: { attempt_id: r1.id, request_no: reqC } })).data, true);
ok('지운다', await removePhoto(r1.id, before[5]));
eq('지우는 순간 사진 채점이 비워진다', (await gradingOf(r1.id)).score.graded, 0);
const finished = await db().rpc('finish_photo_read', { payload: {
  attempt_id: r1.id, request_no: reqC, photo_ids: before, answers: read1.answers, unreadable: [], note: '' } });
eq('읽는 사이 사진이 바뀌면 결과를 버린다', finished.data, 'CHANGED');
const changed = (await getPhotoRead(r1.id))!;
eq('실패(PHOTOS_CHANGED)로 적힌다', [changed.status, changed.error], ['failed', 'PHOTOS_CHANGED']);
eq('채점은 여전히 비어 있다', (await gradingOf(r1.id)).score.graded, 0);
eq('제출하면 다시 읽기를 부른다', await ensurePhotoRead(r1.id, hold), 'QUEUED');
eq('읽는다', await runNext(), 'DONE');
eq('다섯 장으로 다시 채운다', (await gradingOf(r1.id)).score.graded, 27);
eq('이미 새 읽기가 있으면 제출해도 안 부른다', await ensurePhotoRead(r1.id, hold), 'FRESH');

section('24. 횟수 상한 — 부르기만 막고, 옛 채점은 그래도 비운다');
await db().from('lms_photo_reads').update({ runs: PHOTO_READ.maxStudentRuns - 1 }).eq('attempt_id', r1.id);
const { data: lastAllowed } = await db().rpc('request_photo_read', { payload: { attempt_id: r1.id, max_runs: PHOTO_READ.maxStudentRuns } });
ok('마지막 허용 읽기', Number(lastAllowed) > 0);
await db().rpc('claim_photo_read', { payload: { attempt_id: r1.id, request_no: lastAllowed } });
const duringIds = await photoIdsOf(r1.id);
await addPhoto(r1.id, JPEG);
eq('학생 쪽은 상한에 걸린다', await requestPhotoRead(r1.id, { by: 'student', delayMs: 0, schedule: hold }), 'CAPPED');
eq('그래도 옛 사진 채점은 비워졌다', (await gradingOf(r1.id)).score.graded, 0);
eq('번호가 안 올라도 옛 결과는 버린다', (await db().rpc('finish_photo_read', { payload: {
  attempt_id: r1.id, request_no: lastAllowed, photo_ids: duringIds, answers: read1.answers, unreadable: [], note: '' } })).data, 'CHANGED');
eq('채점은 비어 있다', (await gradingOf(r1.id)).score.graded, 0);
eq('튜터는 상한과 상관없이 부른다', await requestPhotoRead(r1.id, { by: 'tutor', schedule: hold }), 'QUEUED');
eq('읽는다', await runNext(), 'DONE');
eq('여섯 장으로 채운다', (await gradingOf(r1.id)).score.graded, 27);

section('25. 튜터가 매긴 채점과 공개한 점수는 덮지 않는다');
const g25 = await gradingOf(r1.id);
const q5 = (await listQuestions(exam5)).find((q) => q.no === 5)!;
await saveGrading({ attemptId: r1.id, overallComment: '사진 보고 확인함', status: 'draft',
  answers: [...g25.answers, { question_id: q5.id, correct: true, chosen: 1 }] });
eq('튜터 채점이 된다', (await gradingOf(r1.id)).attempt.answers_source, 'tutor');
await requestPhotoRead(r1.id, { by: 'tutor', schedule: hold });
await runNext();
eq('다시 읽어도 튜터 채점은 그대로', (await gradingOf(r1.id)).score.graded, 28);
eq('튜터가 누르면 읽은 답으로 다시 매긴다', await applyPhotoRead(r1.id, true), 27);
const g25b = await gradingOf(r1.id);
eq('다시 사진 채점 · 총평은 그대로', [g25b.attempt.answers_source, g25b.attempt.overall_comment], ['photo', '사진 보고 확인함']);
await saveGrading({ attemptId: r1.id, answers: g25b.answers, overallComment: '공개', status: 'published' });
eq('공개한 응시는 튜터가 눌러도 안 바꾼다', await applyPhotoRead(r1.id, true), -1);
const photosOfR1 = await photoIdsOf(r1.id);
await removePhoto(r1.id, photosOfR1[photosOfR1.length - 1]);
eq('공개한 뒤에는 사진을 바꿔도 점수가 그대로', (await gradingOf(r1.id)).score.graded, 27);

const r2 = await openAttempt(exam5, students[1].id);
await saveGrading({ attemptId: r2.id, answers: [], overallComment: '먼저 적은 총평', status: 'draft' });
eq('아무것도 안 매기고 저장하면 누구의 채점도 아니다', (await getAttempt(r2.id))!.answers_source, null);

section('26. 일괄 공개와 답변 PDF 는 지금 채점을 다시 본다');
for (let i = 0; i < 2; i += 1) await addPhoto(r2.id, JPEG);
replyFor = () => wholePaper;
await requestPhotoRead(r2.id, { by: 'student', delayMs: 0, schedule: hold });
await runNext();
ok('나은은 사진만으로 다 매겨졌다', (await gradingOf(r2.id)).score.complete);
// 화면이 '채점 끝' 을 본 뒤 학생이 사진을 바꾼다
await addPhoto(r2.id, JPEG);
eq('그사이 비워진 채점은 공개하지 않는다',
  (await db().rpc('publish_grades', { payload: { exam_id: exam5, attempt_ids: [r2.id] } })).data, 0);
eq('비공개 그대로', (await getAttempt(r2.id))!.status, 'draft');
await requestPhotoRead(r2.id, { by: 'student', delayMs: 0, schedule: hold });
await runNext();

await saveConcerns(r2.id, [{ question_no: 0, body: '시간 배분' }], true);
const r2Concern = (await listConcerns(r2.id))[0];
await saveConcernAnswers(r2.id, [{ id: r2Concern.id, answer: '1–20번에 45분' }]);
const snapshot = await listAnswers(r2.id);
await addPhoto(r2.id, JPEG);
const regraded = await db().rpc('mark_feedback_ready', { payload: {
  attempt_id: r2.id, path: 'attempts/x/feedback-0.pdf', concern_ids: [r2Concern.id], publish: true, answers: snapshot } });
eq('PDF 를 만든 뒤 채점이 바뀌면 보내지 않는다', regraded.error?.message, 'REGRADED');
eq('보냄으로 표시되지 않았다', (await getAttempt(r2.id))!.feedback_ready_at, null);
await requestPhotoRead(r2.id, { by: 'student', delayMs: 0, schedule: hold });
await runNext();
const sentWithScore = await sendFeedback(r2.id);
eq('그대로면 보내면서 점수를 연다', sentWithScore.ok && sentWithScore.published, true);
eq('공개됐다', (await getAttempt(r2.id))!.status, 'published');

const r1Board = await publishGradedAttempts((await listExams(course2)).find((e) => e.id === exam5)!);
eq('다 공개돼 새로 공개할 것이 없다', r1Board.published, 0);

section('27. 실패는 적고, 마감 시각을 넘기지 않는다');
const r3Student = id(await createUser({ role: 'student', login_id: 'rahee', password: 'student-pass', name: '라희' }));
await enroll(course2, r3Student);
const r3 = await openAttempt(exam5, r3Student);
await addPhoto(r3.id, JPEG);
replyFor = () => ({ kind: 'refuse' });
await requestPhotoRead(r3.id, { by: 'tutor', schedule: hold });
eq('거절되면 실패', await runNext(), 'FAILED');
eq('이유가 적힌다 (거절)', (await getPhotoRead(r3.id))?.error, 'REFUSED');

replyFor = () => ({ kind: 'status', status: 429, headers: { 'retry-after-ms': '1' } });
const beforeLimit = modelCalls.length;
await requestPhotoRead(r3.id, { by: 'tutor', schedule: hold });
eq('요청이 몰리면 실패', await runNext(), 'FAILED');
eq('두 번 더 보내 보고 멈춘다', modelCalls.length - beforeLimit, 1 + PHOTO_READ.maxRetries);
eq('이유가 적힌다 (요청 몰림)', (await getPhotoRead(r3.id))?.error, 'RATE_LIMIT');

replyFor = () => ({ kind: 'hang' });
const { data: hangReq } = await db().rpc('request_photo_read', { payload: { attempt_id: r3.id, max_runs: null } });
const hangStart = Date.now();
const hung = await runPhotoRead(r3.id, Number(hangReq), {
  deadline: hangStart + 1_500,
  timing: { minCallMs: 100, reserveMs: 150, callTimeoutMs: 5_000, maxRetries: 2 },
});
const hangMs = Date.now() - hangStart;
eq('응답이 없으면 마감에 실패로 끝난다', [hung, (await getPhotoRead(r3.id))?.error], ['FAILED', 'TIMEOUT']);
ok('마감 전에 적는다', hangMs < 1_500, hangMs);

// 사진을 다 지우면 모델을 부르지 않는다
const runsBeforeEmpty = (await getPhotoRead(r3.id))!.runs;
const r3Photos = await listPhotos(r3.id);
for (const p of r3Photos) await removePhoto(r3.id, p.id);
const emptied = (await getPhotoRead(r3.id))!;
eq('마지막 사진을 지우면 읽기 기록이 빈 결과로 닫힌다', [emptied.status, emptied.error, emptied.photo_ids], ['done', null, []]);
eq('모델을 부른 횟수는 그대로 (지웠다 올려 상한을 못 푼다)', emptied.runs, runsBeforeEmpty);
const beforeEmpty = modelCalls.length;
eq('사진이 없으면 부르지 않는다', await requestPhotoRead(r3.id, { by: 'tutor', schedule: hold }), 'EMPTY');
eq('모델도 안 불렀다', modelCalls.length, beforeEmpty);
eq('상태도 읽을 것 없음', readViewOf(await getPhotoRead(r3.id), []).kind, 'none');

section('28. 매일 새벽 되살리기 — 상한에 걸린 줄에 밀리지 않는다');
replyFor = () => wholePaper;
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
for (let i = 0; i < 5; i += 1) {
  const sid = id(await createUser({ role: 'student', login_id: `stuck${i}`, password: 'student-pass', name: `오래${i}` }));
  await enroll(course2, sid);
  const at_ = await openAttempt(exam5, sid);
  await addPhoto(at_.id, JPEG);
  const { data: n } = await db().rpc('request_photo_read', { payload: { attempt_id: at_.id, max_runs: null } });
  await db().rpc('fail_photo_read', { payload: { attempt_id: at_.id, request_no: n, error: 'RATE_LIMIT' } });
  await db().from('lms_photo_reads').update({ runs: PHOTO_READ.maxRetryRuns, updated_at: hours(10 - i) }).eq('attempt_id', at_.id);
}
const freshSid = id(await createUser({ role: 'student', login_id: 'fresh1', password: 'student-pass', name: '새로' }));
await enroll(course2, freshSid);
const fresh = await openAttempt(exam5, freshSid);
await addPhoto(fresh.id, JPEG);
const { data: freshReq } = await db().rpc('request_photo_read', { payload: { attempt_id: fresh.id, max_runs: null } });
await db().rpc('fail_photo_read', { payload: { attempt_id: fresh.id, request_no: freshReq, error: 'RATE_LIMIT' } });
await db().from('lms_photo_reads').update({ runs: 1, updated_at: hours(1) }).eq('attempt_id', fresh.id);

const stuckSid = id(await createUser({ role: 'student', login_id: 'stuck-run', password: 'student-pass', name: '멈춤' }));
await enroll(course2, stuckSid);
const stuckAt = await openAttempt(exam5, stuckSid);
await addPhoto(stuckAt.id, JPEG);
const { data: stuckReq } = await db().rpc('request_photo_read', { payload: { attempt_id: stuckAt.id, max_runs: null } });
await db().rpc('claim_photo_read', { payload: { attempt_id: stuckAt.id, request_no: stuckReq } });
await db().from('lms_photo_reads').update({ updated_at: new Date(Date.now() - PHOTO_READ.stuckMs - 60_000).toISOString() }).eq('attempt_id', stuckAt.id);

const revived = await retryPhotoReads({ deadline: Date.now() + 120_000, limit: 5, runMs: 1_000 });
eq('상한에 걸린 다섯 줄은 건너뛰고 둘을 되살린다', revived, { found: 2, done: 2, failed: 0 });
eq('새 실패가 채워졌다', (await gradingOf(fresh.id)).score.complete, true);
eq('멈췄던 읽기도 채워졌다', (await getPhotoRead(stuckAt.id))?.status, 'done');

model.closeAllConnections();
await new Promise((resolve) => model.close(resolve));

done();
