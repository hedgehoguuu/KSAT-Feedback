/**
 * 진짜 DB 에 붙여 수업 한 회차를 통째로 돌리는 시험. `npm run test:db` 가 이걸 돌린다.
 *
 * 순수 계산(test/logic.ts)만으로는 못 잡는 것들이 있다 — 제약이 실제로 거는가,
 * 연쇄 삭제가 도는가, 못 읽었을 때 조용히 빈 목록이 되지 않는가. 그건 붙여 봐야 안다.
 * 실제로 이 시험을 만들다가 채점이 통째로 사라지는 버그를 찾았다 (0012).
 *
 * ── 돌리기 전에
 * 이 시험은 LMS 표를 **비운다**. 운영 DB 에 붙이면 학생 성적이 전부 사라진다.
 * 그래서 평소 환경변수(SUPABASE_URL)를 쓰지 않고 일부러 다른 이름을 본다.
 *
 *   TEST_SUPABASE_URL=...            버릴 수 있는 Supabase 프로젝트
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *
 * 무료 프로젝트를 하나 더 만들어 마이그레이션만 돌려 두고 쓰면 된다.
 */
import { section, ok, eq, done } from './assert.ts';

/* ─────────────────────────────────────────────── 운영 DB 를 지우지 않게 */

const url = process.env.TEST_SUPABASE_URL;
const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log(`
  이 시험은 진짜 DB 가 필요하고, 붙은 DB 의 LMS 표를 **비운다**.

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

const { createUser, findForLogin, getStudent, listStudents, listUsers, resetPassword,
        tryUserCount, updateUser, deleteUser, upsertStudentProfile } = await import('../src/lib/lms/users.ts');
const { saveCourse, listCourses, enroll, listEnrolled, courseVisibleTo, studentVisibleTo,
        unenroll, isEnrolled } = await import('../src/lib/lms/courses.ts');
const { saveExam, listExams, listQuestions, replaceQuestions, defaultQuestionRows, openAttempt,
        saveGrading, loadGrading, examBoard, courseSummary, studentHistory, copyQuestionTable,
        publishGradedAttempts, listAnswers, listAreaComments, deleteExam } = await import('../src/lib/lms/exams.ts');
const { verifyPassword } = await import('../src/lib/lms/password.ts');
const { db } = await import('../src/lib/lms/db.ts');

/* ─────────────────────────────────────────────────────────── 비우기 */

// 사람을 지우면 반·회차·응시·정오가 연쇄로 따라 사라진다 (0008 의 on delete cascade).
for (const table of ['lms_answers', 'lms_area_comments', 'lms_attempts', 'lms_exam_questions',
                     'lms_exams', 'lms_enrollments', 'lms_courses', 'lms_students', 'lms_users']) {
  const { error } = await db().from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  // 기본키가 id 가 아닌 표(정오·수강·코멘트)는 위가 안 먹으므로 한 번 더 넓게 지운다.
  if (error) await db().from(table).delete().gte('attempt_id', '00000000-0000-0000-0000-000000000000');
}

/* ═══════════════════════════════════════════════════════════ 시작 */

const id = (r: unknown) => (r as { id: string }).id;

section('1. 계정');
ok('처음엔 계정이 0명', (await tryUserCount()) === 0, String(await tryUserCount()));

const adminId = id(await createUser({ role: 'admin', login_id: 'boss', password: 'admin-pass-1', name: '주현' }));
ok('첫 관리자가 만들어진다', Boolean(adminId));
eq('대소문자만 다른 아이디는 거절',
  await createUser({ role: 'tutor', login_id: 'BOSS', password: 'x'.repeat(8), name: '남' }), 'DUPLICATE_ID');

const tutorId = id(await createUser({ role: 'tutor', login_id: 'seohyun', password: 'tutor-pass-1', name: '서현' }));
const students: { id: string; name: string; elective: 'speech' | 'media' }[] = [];
for (const [name, login, el] of [['가영', 'gayoung', 'speech'], ['나은', 'naeun', 'media'], ['다희', 'dahee', 'speech']] as const) {
  students.push({
    id: id(await createUser({ role: 'student', login_id: login, password: 'student-pass', name,
      student: { grade: 3, elective: el, school: '인천고', parent_phone: '010-0000-0000' } })),
    name, elective: el,
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
ok('선택과목·학년·학교가 저장된다',
  prof?.profile?.elective === 'speech' && prof?.profile?.grade === 3 && prof?.profile?.school === '인천고');
ok('목록에 프로필이 붙어 온다', (await listStudents()).every((s) => s.profile !== null));
eq('튜터는 1명', (await listUsers('tutor')).length, 1);

section('4. 반과 수강');
const courseId = await saveCourse({ name: '목19 국어', tutor_id: tutorId, class_id: null, status: 'active', memo: null });
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
eq('명단에 관리자 줄이 없다',
  (await db().from('lms_enrollments').select('student_id').eq('student_id', adminId)).data?.length, 0);
ok('관리자 계정은 튜터에게 학생으로 안 잡힌다', !(await studentVisibleTo(adminId, { id: tutorId, role: 'tutor' })));
eq('학생 전용 재발급은 관리자 계정을 못 바꾼다',
  await resetPassword(adminId, 'hijacked-pass', { studentOnly: true }), false);
ok('관리자 비밀번호가 그대로', verifyPassword('new-admin-pass', (await findForLogin('boss'))!.password_hash));
ok('수강생은 명단에 있다', await isEnrolled(courseId, students[0].id));
ok('관리자는 명단에 없다 (채점을 못 연다)', !(await isEnrolled(courseId, adminId)));

section('5. 회차와 문항표');
const examId = await saveExam({ course_id: courseId, title: '1주차', exam_date: '2026-09-10', status: 'draft' });
await replaceQuestions(examId, defaultQuestionRows(45));
const qs = await listQuestions(examId);
eq('45문항 + 선택 한 벌 더', qs.length, 56);
eq('35번이 화작·언매 두 줄', qs.filter((q) => q.no === 35).length, 2);
eq('18번이 갈래복합', qs.find((q) => q.no === 18)?.area_code, 'lit_complex');
ok('배점이 숫자로 온다 (numeric 문자열 아님)', typeof qs[0].points === 'number');

section('6. 채점');
const attempt = await openAttempt(examId, students[0].id);
eq('학생의 선택과목이 응시에 베껴진다', attempt.elective, 'speech');
eq('두 번 열어도 같은 응시', (await openAttempt(examId, students[0].id)).id, attempt.id);

const mine = qs.filter((q) => q.area_code !== 'el_media');
const wrong = new Set(mine.filter((q) => q.area_code === 'lit_complex').slice(0, 4).map((q) => q.id));
await saveGrading({
  attemptId: attempt.id, elective: 'speech',
  answers: mine.map((q) => ({ question_id: q.id, correct: !wrong.has(q.id), chosen: wrong.has(q.id) ? 3 : null })),
  areaComments: [{ area_code: 'lit_complex', comment: '(가)(나) 묶어 읽기' }],
  overallComment: '문학 첫 세트에서 시간이 샜어요', status: 'draft',
});
const graded = (await loadGrading(attempt.id))!;
eq('만점 90점', graded.score.total, 90);
eq('4문항 틀려 82점', graded.score.earned, 82);
ok('채점 완료로 잡힌다', graded.score.complete);
eq('언매 문항은 안 센다', graded.score.count, 45);
eq('갈래복합 2/6', graded.score.areas.find((a) => a.code === 'lit_complex')?.correct, 2);
ok('영역 코멘트가 돌아온다', graded.areaComments.get('lit_complex')?.includes('(가)(나)') === true);
ok('총평이 돌아온다', graded.attempt.overall_comment?.includes('시간이 샜') === true);
ok('고른 답이 저장된다', (await listAnswers(attempt.id)).some((a) => a.chosen === 3));

section('7. 채점 저장은 한 덩어리여야 한다 (0012)');
// 없는 문항 id 를 섞으면 함수 안에서 delete 다음에 터진다 — 예전에 채점이 날아가던 지점이다.
let threw = false;
try {
  await saveGrading({
    attemptId: attempt.id, elective: 'speech',
    answers: [...graded.answers, { question_id: '00000000-0000-0000-0000-000000000000', correct: true, chosen: null }],
    areaComments: [{ area_code: 'lit_complex', comment: '들어가면 안 되는 코멘트' }],
    overallComment: '들어가면 안 되는 총평', status: 'published',
  });
} catch { threw = true; }
ok('실패하면 던진다 (화면이 거짓말 안 함)', threw);
const afterFail = (await loadGrading(attempt.id))!;
eq('점수가 그대로', afterFail.score.earned, 82);
eq('정오가 그대로', (await listAnswers(attempt.id)).length, 45);
eq('총평이 안 덮였다', afterFail.attempt.overall_comment, graded.attempt.overall_comment);
eq('공개 상태가 안 바뀌었다', afterFail.attempt.status, 'draft');
ok('실패한 코멘트가 안 들어갔다',
  !(await listAreaComments(attempt.id)).get('lit_complex')?.includes('들어가면 안 되는'));

section('8. 언매 학생 (0010)');
const a2 = await openAttempt(examId, students[1].id);
const media = qs.filter((q) => q.area_code !== 'el_speech');
await saveGrading({ attemptId: a2.id, elective: 'media',
  answers: media.map((q) => ({ question_id: q.id, correct: true, chosen: null })),
  areaComments: [], overallComment: null, status: 'draft' });
eq('언매 학생 만점도 90점 (68점 아님)', (await loadGrading(a2.id))!.score.total, 90);

section('9. 반 비교');
const exam = (await listExams(courseId))[0];
const board = await examBoard(exam);
eq('명단에 3명 (미채점 포함)', board.rows.length, 3);
eq('채점 끝난 2명만 평균에', board.stats.counted, 2);
eq('평균 86점', board.stats.average, 86);
eq('1등은 나은', board.stats.standings[0].name, '나은');
eq('미채점 학생은 석차 없음', board.stats.standings.find((s) => s.name === '다희')?.rank, 0);
eq('가영은 평균 -4점', board.stats.standings.find((s) => s.name === '가영')?.vsAverage, -4);

section('10. 일괄 공개 — 채점 끝난 것만');
const res = await publishGradedAttempts(exam);
eq('2명 공개', res.published, 2);
eq('미채점 1명은 남는다', res.skipped, 1);
eq('다시 눌러도 새로 공개할 게 없다', (await publishGradedAttempts(exam)).published, 0);

section('11. 학생이 보는 것');
eq('회차가 비공개면 채점을 공개해도 안 보인다',
  (await studentHistory(students[0].id, { publishedOnly: true })).points.length, 0);
await saveExam({ id: examId, course_id: courseId, title: '1주차', exam_date: '2026-09-10', status: 'published' });
const hist = await studentHistory(students[0].id, { publishedOnly: true });
eq('공개된 회차가 보인다', hist.points.length, 1);
eq('점수가 맞는다', hist.points[0].score.earned, 82);
ok('영역 코멘트가 보인다', hist.points[0].areaComments.get('lit_complex') !== undefined);
eq('가장 약한 영역', hist.trends[0].code, 'lit_complex');
eq('채점 안 끝난 학생에겐 아무것도', (await studentHistory(students[2].id, { publishedOnly: true })).points.length, 0);

section('12. 문항표 복사 — 정답은 안 온다');
await replaceQuestions(examId, qs.map((q) => ({ ...q, answer: 3 })));
ok('원본에 정답이 들어갔다', (await listQuestions(examId)).every((q) => q.answer === 3));
const exam2 = await saveExam({ course_id: courseId, title: '2주차', exam_date: '2026-09-17', status: 'draft' });
eq('56줄이 복사된다', await copyQuestionTable(examId, exam2), 56);
const q2 = await listQuestions(exam2);
eq('영역은 그대로', q2.find((q) => q.no === 18)?.area_code, 'lit_complex');
ok('정답은 안 온다', q2.every((q) => q.answer === null));

section('13. 문항표를 고쳐도 채점이 살아남나');
const cur = await listQuestions(examId);
await replaceQuestions(examId, cur.map((q) => ({ ...q, points: q.no === 1 ? 3 : q.points })));
eq('배점만 고치면 O/X 는 남는다 (82 → 83)', (await loadGrading(attempt.id))!.score.earned, 83);
await replaceQuestions(examId, cur.filter((q) => q.no !== 2).map((q) => ({ ...q, points: q.no === 1 ? 3 : q.points })));
const g3 = (await loadGrading(attempt.id))!;
eq('문항을 지우면 그 정오도 사라진다', g3.score.count, 44);
eq('지운 문항 배점만큼 줄어든다', g3.score.earned, 81);

section('14. 반 누적');
const summary = await courseSummary(courseId);
eq('회차 2개', summary.exams.length, 2);
eq('학생 3명', summary.rows.length, 3);
const gy = summary.rows.find((r) => r.student.name === '가영')!;
ok('평균이 100점 환산으로 나온다', gy.average > 90 && gy.average < 96, String(gy.average));
eq('본 회차 1개', gy.taken, 1);
ok('영역별 누적이 쌓인다', gy.areas.some((a) => a.code === 'lit_complex'));

section('15. 지우면 함께 사라지나');
await unenroll(courseId, students[2].id);
ok('반에서 빼도 계정은 남는다', (await getStudent(students[2].id)) !== null);
eq('수강생이 2명', (await listEnrolled(courseId)).length, 2);
eq('반을 맡은 튜터는 못 지운다', await deleteUser(tutorId), 'IN_USE');
await deleteUser(students[1].id);
eq('학생을 지우면 응시도 사라진다',
  (await studentHistory(students[1].id, { publishedOnly: false })).points.length, 0);
eq('남은 학생 성적은 그대로', (await loadGrading(attempt.id))!.score.earned, 81);
await deleteExam(exam2);
eq('회차를 지우면 그 문항표도', (await listQuestions(exam2)).length, 0);

section('16. 프로필을 고쳐도 지난 채점은 그대로');
await upsertStudentProfile(students[0].id, { grade: 3, elective: 'media', school: '인천고',
  parent_phone: null, receipt_no: 'F0902-013', memo: null });
eq('선택과목이 바뀐다', (await getStudent(students[0].id))!.profile!.elective, 'media');
eq('지난 회차 응시는 화작 그대로', (await loadGrading(attempt.id))!.attempt.elective, 'speech');
eq('그래서 점수도 그대로', (await loadGrading(attempt.id))!.score.earned, 81);
await updateUser(students[0].id, { status: 'suspended' });
eq('정지시킬 수 있다', (await listStudents()).find((s) => s.id === students[0].id)?.status, 'suspended');

section('17. 다른 튜터 반의 채점은 딸려 오지 않는다');
const tutor2 = id(await createUser({ role: 'tutor', login_id: 'tutor-two', password: 'tutor-pass-2', name: '둘째' }));
const course2 = await saveCourse({ name: '특강', tutor_id: tutor2, class_id: null, status: 'active', memo: null });
await enroll(course2, students[0].id);
const exam3 = await saveExam({ course_id: course2, title: '특강 1회', exam_date: '2026-09-20', status: 'draft' });
await replaceQuestions(exam3, defaultQuestionRows(10));
const a3 = await openAttempt(exam3, students[0].id);
await saveGrading({ attemptId: a3.id, elective: 'speech', answers: [],
  areaComments: [{ area_code: 'read_theory', comment: '특강 튜터만 볼 코멘트' }],
  overallComment: '비공개 총평', status: 'draft' });
const firstTutorView = await studentHistory(students[0].id, { publishedOnly: false, courseIds: [courseId] });
ok('첫 튜터에게는 자기 반 회차만', firstTutorView.points.every((p) => p.exam.course_id === courseId));
ok('특강 회차는 안 온다', !firstTutorView.points.some((p) => p.exam.id === exam3));
ok('관리자(반 제한 없음)는 둘 다 본다',
  (await studentHistory(students[0].id, { publishedOnly: false })).points.some((p) => p.exam.id === exam3));

done();
