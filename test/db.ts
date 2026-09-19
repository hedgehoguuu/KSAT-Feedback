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

const { createUser, findForLogin, getStudent, listStudents, listUsers, resetPassword, changeOwnPassword,
        sessionKeyOf, tryUserCount, updateUser, deleteUser, upsertStudentProfile } = await import('../src/lib/lms/users.ts');
const { saveCourse, listCourses, enroll, listEnrolled, courseVisibleTo, studentVisibleTo,
        unenroll, isEnrolled, deleteCourse } = await import('../src/lib/lms/courses.ts');
const { saveExam, listExams, listQuestions, saveAnswerKey, seedQuestions, openAttempt, findAttempt,
        saveGrading, loadGrading, examBoard, courseSummary, studentHistory, examAverages,
        listAnswers, deleteExam, getAttempt } = await import('../src/lib/lms/exams.ts');
const { addPhoto, listPhotos, movePhoto, removePhoto } = await import('../src/lib/lms/photos.ts');
const { saveConcerns, listConcerns, saveConcernAnswers, setAnswerImage, clearAnswerImage,
        cleanConcerns } = await import('../src/lib/lms/concerns.ts');
const { sendFeedback, feedbackPdfOf } = await import('../src/lib/lms/feedback.ts');
const { pendingFeedback, studentExams } = await import('../src/lib/lms/lists.ts');
const { LMS_BUCKET, getFile } = await import('../src/lib/lms/files.ts');
const { verifyPassword } = await import('../src/lib/lms/password.ts');
const { db } = await import('../src/lib/lms/db.ts');
const { PAPER } = await import('../src/config/lms.ts');
const { readOmr } = await import('../src/lib/lms/ocr.ts');
const { fillFromOmr } = await import('../src/lib/lms/omr-fill.ts');
const { gradingSnapshot, changedNos } = await import('../src/lib/lms/grading-snapshot.ts');

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
const keyBefore = await sessionKeyOf(adminId);
await resetPassword(adminId, 'new-admin-pass');
ok('재발급이 실제로 반영된다', verifyPassword('new-admin-pass', (await findForLogin('boss'))!.password_hash));
const keyAfterReset = await sessionKeyOf(adminId);
ok('재발급하면 세션 열쇠가 바뀐다 — 다른 기기의 로그인이 풀린다', keyAfterReset !== null && keyAfterReset !== keyBefore);
const ownKey = await changeOwnPassword(adminId, 'new-admin-pass');
ok('본인이 바꿔도 열쇠가 바뀌고, 지금 브라우저에 줄 열쇠를 돌려준다',
  ownKey !== null && ownKey !== keyAfterReset && ownKey === (await sessionKeyOf(adminId)));
ok('본인이 바꾸면 강제 변경이 꺼진다', !(await findForLogin('boss'))!.must_change_password);

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
  overallComment: '4점에서 방향을 늦게 잡았어요', base: null,
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
    overallComment: '들어가면 안 되는 총평', base: null,
  });
} catch { threw = true; }
ok('다른 회차 문항이 섞이면 던진다 (화면이 거짓말 안 함)', threw);
const afterFail = (await loadGrading(attempt.id))!;
eq('점수가 그대로', afterFail.score.earned, 92);
eq('정오가 그대로', (await listAnswers(attempt.id)).length, 30);
eq('총평이 안 덮였다', afterFail.attempt.overall_comment, graded.attempt.overall_comment);
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
  overallComment: null, base: null });
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

section('10. 반 평균 — 학생에게 보이는 채점만 센다');
eq('채점 끝난 두 명의 평균', (await examAverages([examId])).get(examId), { average: 94, counted: 2 });

section('11. 학생이 보는 것 — 공개 단추 없이, 다 매겨 저장하면 보인다 (0020)');
eq('회차가 준비 중이면 안 보인다',
  (await studentHistory(students[0].id, { forStudent: true })).points.length, 0);
eq('준비 중인 회차는 학생 시험 목록에도 없다', (await studentExams(students[0].id)).length, 0);
await saveExam({ id: examId, course_id: courseId, title: '1주차', exam_date: '2026-09-17', due_date: '2026-09-24', status: 'published' });
const hist = await studentHistory(students[0].id, { forStudent: true });
eq('회차를 열면 다 매긴 점수가 바로 보인다', hist.points.length, 1);
eq('점수가 맞는다', hist.points[0].score.earned, 92);
eq('누적 단원 칸', hist.trends.units.map((t) => t.code), ['m1_seq']);
eq('채점 안 끝난 학생에겐 점수가 없다', (await studentHistory(students[2].id, { forStudent: true })).points.length, 0);
eq('열린 회차는 학생 시험 목록에 뜬다', (await studentExams(students[2].id)).map((e) => e.exam.title), ['1주차']);
const partial = await openAttempt(examId, students[2].id);
await saveGrading({ attemptId: partial.id, overallComment: null, base: null,
  answers: qs.filter((q) => q.no !== 30).map((q) => ({ question_id: q.id, correct: true, chosen: q.answer })) });
eq('덜 매긴 채점(29/30)은 학생에게 안 보인다',
  (await studentHistory(students[2].id, { forStudent: true })).points.length, 0);
eq('반 평균에도 안 들어간다', (await examAverages([examId])).get(examId)?.counted, 2);

section('12. 시험지 사진');
const p1 = await addPhoto(attempt.id, JPEG);
const p2 = await addPhoto(attempt.id, JPEG);
ok('사진 두 장', typeof p1 === 'object' && typeof p2 === 'object');
const photo1 = p1 as Exclude<typeof p1, 'TOO_MANY' | 'LOCKED'>;
const photo2 = p2 as Exclude<typeof p2, 'TOO_MANY' | 'LOCKED'>;
ok('저장소에 파일이 있다', await fileExists(photo1.storage_path));
eq('다른 학생 응시로는 못 지운다', await removePhoto(a2.id, photo1.id), 'NOT_FOUND');
await movePhoto(attempt.id, photo2.id, -1);
eq('순서를 바꾼다', (await listPhotos(attempt.id)).map((p) => p.id), [photo2.id, photo1.id]);
eq('지우면 줄이 사라진다', await removePhoto(attempt.id, photo2.id), 'OK');
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
eq('다 달았으면 보낸다 (메일 설정이 없으니 메일은 안 감 · 다 매긴 점수가 든다)', sent, { ok: true, mail: { status: 'NOT_CONFIGURED' }, scored: true });
const afterSend = (await getAttempt(attempt.id))!;
ok('보낸 시각과 PDF 경로가 적힌다', Boolean(afterSend.feedback_ready_at && afterSend.feedback_path));
eq('메일이 안 간 이유가 적힌다', afterSend.mail_error, 'NOT_CONFIGURED');
const pdf = await feedbackPdfOf(afterSend);
eq('학생이 받을 PDF', pdf ? Buffer.from(pdf.slice(0, 5)).toString() : null, '%PDF-');
eq('보낸 뒤 학생 쪽은 잠긴다', await saveConcerns(attempt.id, [], true), 'LOCKED');
// 학생 쪽 서버 함수가 먼저 본 뒤 튜터가 보내기를 끝낸 경우 — DB 가 사진을 막는다 (0018)
const lateAdd = await addPhoto(attempt.id, JPEG);
eq('보낸 뒤에는 사진을 못 넣는다', lateAdd, 'LOCKED');
eq('보낸 뒤에는 사진을 못 지운다', await removePhoto(attempt.id, photo1.id), 'LOCKED');
ok('거절돼도 사진 파일은 그대로', await fileExists(photo1.storage_path));
eq('사진은 한 장 그대로', (await listPhotos(attempt.id)).length, 1);
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

// 다희: 29문항만 매겨 둔 것을 마저 매기고 보낸다
const a3 = await openAttempt(examId, students[2].id);
await saveGrading({ attemptId: a3.id, answers: qs.map((q) => ({ question_id: q.id, correct: true, chosen: q.answer })),
  overallComment: null, base: null });
await saveConcerns(a3.id, [{ question_no: 30, body: '맞았지만 불안했어요' }], true);
await saveConcernAnswers(a3.id, [{ id: (await listConcerns(a3.id))[0].id, answer: '풀이가 맞아요' }]);
const withScore = await sendFeedback(a3.id);
eq('채점이 끝났으면 PDF 에 점수가 든다', withScore.ok && withScore.scored, true);
eq('다희 학생 화면에 점수', (await studentHistory(students[2].id, { forStudent: true })).points[0]?.score.earned, 100);

// 점수가 든 PDF 는 만든 뒤 채점이 바뀌면 '보냄' 으로 표시하지 않는다 (0018)
const a3Before = (await loadGrading(a3.id))!;
const a3Base = gradingSnapshot(a3Before.questions, a3Before.answers);
await saveGrading({ attemptId: a3.id, answers: a3Before.answers.slice(1), overallComment: null, base: null });
const staleSend = await db().rpc('mark_feedback_ready', { payload: {
  attempt_id: a3.id, path: 'attempts/x/feedback-1.pdf', concern_ids: [(await listConcerns(a3.id))[0].id],
  publish: false, base: a3Base } });
eq('PDF 를 만든 뒤 채점이 바뀌면 보내지 않는다', staleSend.error?.message, 'REGRADED');
await saveGrading({ attemptId: a3.id, answers: a3Before.answers, overallComment: null, base: null });
const sameSend = await db().rpc('mark_feedback_ready', { payload: {
  attempt_id: a3.id, path: (await getAttempt(a3.id))!.feedback_path, concern_ids: [(await listConcerns(a3.id))[0].id],
  publish: false, base: a3Base } });
eq('판이 그대로면 다시 보낸다', sameSend.error, null);
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
  (await studentHistory(students[2].id, { forStudent: false })).points.length, 0);
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
await saveGrading({ attemptId: a4.id, answers: [], overallComment: '비공개 총평', base: null });
const firstTutorView = await studentHistory(students[0].id, { forStudent: false, courseIds: [courseId] });
ok('첫 튜터에게는 자기 반 회차만', firstTutorView.points.every((p) => p.exam.course_id === courseId));
ok('특강 회차는 안 온다', !firstTutorView.points.some((p) => p.exam.id === exam3));
ok('관리자(반 제한 없음)는 둘 다 본다',
  (await studentHistory(students[0].id, { forStudent: false })).points.some((p) => p.exam.id === exam3));
ok('특강 튜터의 할 일에 첫 반 제출이 안 섞인다', (await pendingFeedback([course2])).length === 0);

section('20. 반을 지우면 사진까지');
ok('남은 사진 파일이 있다', await fileExists(kept.storage_path));
await deleteCourse(courseId);
ok('반을 지우면 시험지 사진도 사라진다', !(await fileExists(kept.storage_path)));
ok('응시도 사라진다', (await findAttempt(examId, students[0].id)) === null);

/* ═══════════════════════════════════ OMR 로 채점 · 학생 사진은 질문용 (0020) */

// 모델은 가짜다 — 이 시험이 돈을 쓰거나 밖으로 나가면 안 된다. 요청 모양과 흐름만 본다.
type ModelReply =
  | { kind: 'read'; answers: { no: number; answer: number | null; sure: boolean; note: string | null }[]; unreadable?: number[] }
  | { kind: 'refuse' };
let reply: ModelReply = { kind: 'read', answers: [] };
const modelCalls: { images: number; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
const model = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const content = body.messages[0].content as { type: string }[];
  modelCalls.push({ images: content.filter((c) => c.type === 'image').length, body, headers: req.headers });

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

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sure = (nos: number[]) => nos.map((no) => ({ no, answer: KEY[no - 1], sure: true, note: null }));
const gradingOf = async (attemptId: string) => (await loadGrading(attemptId))!;
const omrImage = { media_type: 'image/jpeg', data: Buffer.from(JPEG).toString('base64') };

section('21. OMR 로 채점 칸 채우기 — 읽기만 하고 저장하지 않는다');
await enroll(course2, students[1].id);
const exam5 = await saveExam({ course_id: course2, title: '특강 2회', exam_date: '2026-09-21', due_date: null, status: 'published' });
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: null })));
const q5 = await listQuestions(exam5);
const r1 = await openAttempt(exam5, students[0].id);
reply = { kind: 'read', answers: [
  ...sure(span(1, 11)),
  { no: 12, answer: KEY[11], sure: false, note: '②와 ③ 둘 다 마킹' },
  ...sure(span(13, 20)),
  { no: 21, answer: null, sure: true, note: null },          // 마킹 없음 — 틀림
  ...sure(span(22, 30)),
] };
const omr = await readOmr([omrImage]);
ok('읽었다', omr.ok, omr);
const call = modelCalls[0];
eq('요청 모양 — 모델 · 거절 대비 · 생각 · 구조화 출력 · 사진 한 장',
  [call.body.model, call.body.fallbacks, (call.body.thinking as { type: string }).type,
   (call.body.output_config as { effort: string }).effort,
   (call.body.output_config as { format: { type: string } }).format.type, call.images],
  ['claude-opus-5', 'default', 'adaptive', 'medium', 'json_schema', 1]);
ok('거절 대비 베타 머리글', String(call.headers['anthropic-beta'] ?? '').includes('server-side-fallback-2026-07-01'));
const g0 = await gradingOf(r1.id);
eq('읽기만 했으니 채점은 비어 있다', [g0.score.graded, g0.attempt.answers_source], [0, null]);
eq('사진도 어디에도 남기지 않는다', (await listPhotos(r1.id)).length, 0);

// 채점 화면이 하는 그대로 — 칸을 채우고, 애매한 12번은 선생님이 사진을 보고 넣은 뒤 저장한다.
const filled = fillFromOmr(q5, omr.ok ? omr.answers : [], { chosen: {}, marks: {} });
eq('애매한 12번만 남긴다', filled.check, [12]);
const toAnswers = (f: { chosen: Record<string, string>; marks: Record<string, string> }) =>
  q5.filter((q) => f.marks[q.id] === 'o' || f.marks[q.id] === 'x').map((q) => ({
    question_id: q.id,
    correct: f.marks[q.id] === 'o',
    chosen: f.chosen[q.id] ? Number(f.chosen[q.id]) : null,
  }));
await saveGrading({ attemptId: r1.id, answers: toAnswers(filled), overallComment: null, base: null });
eq('29문항 — 아직 학생에게 안 보인다',
  (await studentHistory(students[0].id, { forStudent: true })).points.some((p) => p.exam.id === exam5), false);
const q12 = q5.find((q) => q.no === 12)!;
await saveGrading({ attemptId: r1.id, overallComment: 'OMR 확인함', base: null,
  answers: [...toAnswers(filled), { question_id: q12.id, correct: true, chosen: KEY[11] }] });
eq('다 매겨 저장하면 바로 보인다 (21번 4점만 틀림)',
  (await studentHistory(students[0].id, { forStudent: true })).points.find((p) => p.exam.id === exam5)?.score.earned, 96);
eq('선생님 채점이다', (await gradingOf(r1.id)).attempt.answers_source, 'tutor');

section('22. 학생 사진은 채점을 건드리지 않는다 (0020)');
await addPhoto(r1.id, JPEG);
await addPhoto(r1.id, JPEG);
eq('사진을 올려도 채점 그대로', (await gradingOf(r1.id)).score.earned, 96);
eq('지워도', await removePhoto(r1.id, (await listPhotos(r1.id))[0].id), 'OK');
eq('채점 그대로', (await gradingOf(r1.id)).score.graded, 30);

// 0016 시절 학생 사진으로 채우고 아직 아무도 확인하지 않은 채점
const r2 = await openAttempt(exam5, students[1].id);
await saveGrading({ attemptId: r2.id, overallComment: null, base: null,
  answers: q5.map((q) => ({ question_id: q.id, correct: true, chosen: q.answer })) });
await db().from('lms_attempts').update({ answers_source: 'photo' }).eq('id', r2.id);
eq('확인 전 자동 채점은 학생에게 안 보인다', (await studentHistory(students[1].id, { forStudent: true })).points.length, 0);
eq('반 평균에도 안 들어간다 (한 명뿐이라 평균 없음)', (await examAverages([exam5])).has(exam5), false);
await addPhoto(r2.id, JPEG);
eq('학생이 사진을 바꿔도 남은 자동 채점을 지우지 않는다', (await gradingOf(r2.id)).score.graded, 30);
await saveGrading({ attemptId: r2.id, answers: (await gradingOf(r2.id)).answers, overallComment: '확인함', base: null });
eq('선생님이 확인하고 저장하면 보인다', (await studentHistory(students[1].id, { forStudent: true })).points[0]?.score.earned, 100);
eq('이제 반 평균 (96 + 100) / 2', (await examAverages([exam5])).get(exam5), { average: 98, counted: 2 });
eq('반 화면도 같은 두 명으로 센다', (await examBoard((await listExams(course2)).find((e) => e.id === exam5)!)).stats.counted, 2);

section('23. 정답표를 고쳐도 사진 읽기 기록으로 채점을 채우지 않는다 (0020)');
const r3Student = id(await createUser({ role: 'student', login_id: 'rahee', password: 'student-pass', name: '라희' }));
await enroll(course2, r3Student);
const r3 = await openAttempt(exam5, r3Student);
// 0016 시절의 끝난 읽기 한 줄. 예전 정답표 저장은 이것으로 채점을 다시 채웠다.
await db().from('lms_photo_reads').insert({ attempt_id: r3.id, request_no: 1, status: 'done', answers: sure(span(1, 30)) });
const otherFirst = KEY[0] === 1 ? 2 : 1;
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: q.no === 1 ? otherFirst : KEY[q.no - 1], unit_code: null })));
eq('읽기 기록으로 채점을 채우지 않는다', (await gradingOf(r3.id)).score.graded, 0);
eq('적어 둔 학생 답으로 다시 매기는 것은 그대로 (1번이 틀림으로)',
  (await gradingOf(r1.id)).answers.find((a) => a.question_id === q5[0].id)?.correct, false);
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: null })));

section('24. 오래된 채점 화면으로는 저장되지 않는다 — 화면이 본 판(정오 · 정답표)으로 견준다');
const sRev = id(await createUser({ role: 'student', login_id: 'revcheck', password: 'student-pass', name: '판검사' }));
await enroll(course2, sRev);
const rv = await openAttempt(exam5, sRev);
const full = q5.map((q) => ({ question_id: q.id, correct: true, chosen: q.answer }));
await saveGrading({ attemptId: rv.id, answers: full, overallComment: '처음', base: null });
// 채점 화면이 그릴 때 만드는 판 그대로 (GradeSheet)
const snapOf = async (attemptId: string) => {
  const g = await gradingOf(attemptId);
  return gradingSnapshot(g.questions, g.answers);
};
const seen = await snapOf(rv.id);

// 튜터가 화면을 열어 둔 사이 다른 창(다른 선생님)이 먼저 저장한다
eq('먼저 저장한 창은 통과', await saveGrading({ attemptId: rv.id, answers: full.slice(1), overallComment: '다른 창', base: seen }), 'SAVED');
eq('그 전에 연 화면의 저장은 거절한다',
  await saveGrading({ attemptId: rv.id, answers: full, overallComment: '옛 화면', base: seen }), 'STALE');
const afterStale = await gradingOf(rv.id);
eq('아무것도 쓰이지 않았다', [afterStale.score.graded, afterStale.attempt.overall_comment], [29, '다른 창']);
eq('무엇이 바뀌었는지 짚는다', changedNos(seen, await snapOf(rv.id), afterStale.questions), [1]);

const now1 = await snapOf(rv.id);
eq('지금 판으로는 저장된다', await saveGrading({ attemptId: rv.id, answers: full, overallComment: '다시 봤어요', base: now1 }), 'SAVED');
eq('같은 판으로 두 번 저장하면 두 번째는 거절한다',
  await saveGrading({ attemptId: rv.id, answers: full, overallComment: '또', base: now1 }), 'STALE');

// 학생이 질문을 제출하는 것은 채점과 상관없다
const now2 = await snapOf(rv.id);
await saveConcerns(rv.id, [{ question_no: 3, body: '3번 계산이 길어졌어요' }], true);
eq('학생이 질문을 제출해도 튜터의 저장은 된다',
  await saveGrading({ attemptId: rv.id, answers: full, overallComment: '제출 뒤에 저장', base: now2 }), 'SAVED');

// 정답표를 고쳐 다시 매기면 그 전에 연 화면은 옛 O/X 를 들고 있다
const now3 = await snapOf(rv.id);
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: q.no === 1 ? otherFirst : KEY[q.no - 1], unit_code: null })));
eq('정답표를 고친 뒤 그 전에 연 화면의 저장은 거절한다',
  await saveGrading({ attemptId: rv.id, answers: full, overallComment: '옛 정답으로', base: now3 }), 'STALE');
const rekeyed = await gradingOf(rv.id);
eq('다시 매긴 정오가 남아 있다', rekeyed.answers.find((a) => a.question_id === rekeyed.questions[0].id)?.correct, false);
eq('1번이 바뀌었다고 짚는다', changedNos(now3, await snapOf(rv.id), rekeyed.questions), [1]);
await saveAnswerKey(exam5, PAPER.map((q) => ({ no: q.no, answer: KEY[q.no - 1], unit_code: null })));

section('25. 답변 PDF 의 점수는 학생 화면과 같은 기준이다');
await saveConcerns(r2.id, [{ question_no: 0, body: '시간 배분' }], true);
await saveConcernAnswers(r2.id, [{ id: (await listConcerns(r2.id))[0].id, answer: '1–20번에 45분' }]);
const sent2 = await sendFeedback(r2.id);
eq('선생님이 다 매긴 채점은 PDF 에 점수가 든다', sent2.ok && sent2.scored, true);
await saveConcerns(r3.id, [{ question_no: 5, body: '5번 조건을 못 봤어요' }], true);
await saveConcernAnswers(r3.id, [{ id: (await listConcerns(r3.id))[0].id, answer: '둘째 줄 조건부터' }]);
const sent3 = await sendFeedback(r3.id);
eq('안 매긴 응시는 점수 없이 보낸다', sent3.ok && !sent3.scored, true);
eq('보낸 시험의 사진은 여전히 DB 가 막는다', await addPhoto(r3.id, JPEG), 'LOCKED');

section('26. OMR 읽기가 거절되면 이유를 돌려준다');
reply = { kind: 'refuse' };
const refused = await readOmr([omrImage]);
eq('거절', refused.ok ? 'OK' : refused.reason, 'REFUSED');

model.closeAllConnections();
await new Promise((resolve) => model.close(resolve));

done();
