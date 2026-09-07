import { NextResponse } from 'next/server';
import { AREAS, ELECTIVES, fmtScore } from '@/config/lms';
import { currentUser } from '@/lib/lms/auth';
import { courseVisibleTo } from '@/lib/lms/courses';
import { courseSummary } from '@/lib/lms/exams';

export const dynamic = 'force-dynamic';

/**
 * 반 성적을 CSV 로 내려받는다. 상담 자료를 만들거나 기록으로 남길 때 쓴다.
 *
 * 화면이 아니라 파일로 주는 이유: 학부모 상담에서 필요한 건 화면 캡처가 아니라
 * 손대서 정리할 수 있는 표다.
 *
 * 서버 함수가 아니라 라우트인 것은 파일을 내려보내야 해서다 — 서버 함수는 값을 돌려줄 뿐
 * 다운로드를 만들지 못한다. 그래서 잠금을 여기서 다시 건다.
 */

/** 쉼표 · 따옴표 · 줄바꿈이 들어간 값을 안전하게 감싼다. 이름에 쉼표가 있으면 열이 밀린다. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== 'tutor' && user.role !== 'admin')) {
    return new NextResponse('로그인이 필요해요', { status: 401 });
  }

  const { id } = await params;
  const course = await courseVisibleTo(id, user);
  if (!course) return new NextResponse('없는 반이에요', { status: 404 });

  const summary = await courseSummary(id);

  const header = [
    '석차', '이름', '아이디', '학년', '선택과목', '학교', '학부모 연락처',
    '본 회차', '평균(100점 환산)', '최근(100점 환산)', '반 평균 대비',
    ...AREAS.map((a) => `${a.label} 정답률`),
    ...AREAS.map((a) => `${a.label} 맞음/매김`),
  ];

  const rows = summary.rows.map((row) => {
    const profile = row.student.profile;
    const areaOf = (code: string) => row.areas.find((a) => a.code === code);
    return [
      row.rank || '',
      row.student.name,
      row.student.login_id,
      profile?.grade ? `고${profile.grade}` : '',
      profile?.elective ? ELECTIVES[profile.elective] : '',
      profile?.school ?? '',
      profile?.parent_phone ?? '',
      row.taken,
      row.taken ? fmtScore(row.average) : '',
      row.latest !== null ? fmtScore(row.latest) : '',
      row.taken ? fmtScore(row.average - summary.average) : '',
      ...AREAS.map((a) => {
        const found = areaOf(a.code);
        return found && found.graded > 0 ? `${Math.round(found.rate * 100)}%` : '';
      }),
      ...AREAS.map((a) => {
        const found = areaOf(a.code);
        return found && found.graded > 0 ? `${found.correct}/${found.graded}` : '';
      }),
    ];
  });

  const body = [header, ...rows].map((line) => line.map(cell).join(',')).join('\r\n');

  /**
   * 맨 앞의 BOM 이 없으면 한국어 윈도우 엑셀이 이 파일을 EUC-KR 로 읽어서 이름이 전부 깨진다.
   * 세 글자 때문에 파일이 못 쓰게 되는 자리라 반드시 붙인다.
   */
  const csv = `﻿${body}`;

  // 파일 이름에 한글이 들어가므로 RFC 5987 형식으로도 함께 준다.
  const today = new Date().toISOString().slice(0, 10);
  const name = `${course.name}-성적-${today}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="grades-${today}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
