// 로그인 아이디 · 비밀번호 규칙. 화면(계정 만들기 · 비밀번호 바꾸기)과 서버 함수가 같은 것을 본다.
// 비밀번호를 해시로 바꾸는 것은 password.ts (서버 전용) 에 있다.

import { LMS } from '@/config/lms';

/** 아이디가 규칙에 맞으면 null, 아니면 이유를 돌려준다. */
export function loginIdProblem(raw: string): string | null {
  const id = raw.trim().toLowerCase();
  if (!id) return '아이디를 적어주세요';
  if (!LMS.loginIdPattern.test(id)) return '영문 소문자·숫자·(. _ -) 4~32자로 적어주세요';
  return null;
}

export function passwordProblem(raw: string): string | null {
  if (!raw) return '비밀번호를 적어주세요';
  if (raw.length < LMS.minPasswordLength) return `${LMS.minPasswordLength}자 이상으로 적어주세요`;
  return null;
}
