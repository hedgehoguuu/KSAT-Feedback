'use client';

import { useState } from 'react';
import { LMS, ROLES, ROLE_LIST, type Role } from '@/config/lms';
import { btn, input, label } from './Shell';

/**
 * 계정 만들기.
 *
 * 역할을 고르면 아래 칸이 달라지므로 이 폼만 브라우저에서 돈다 — 학년·학교·
 * 학부모 연락처는 학생에게만 있는 칸이라, 튜터를 만들 때 늘 비어 있는 칸이
 * 떠 있으면 무엇을 채워야 하는지가 흐려진다.
 *
 * 선택과목 칸은 없다. 수업이 수학이고 학생은 전부 미적분이다.
 */
export function AccountForm({
  action,
  error,
}: {
  /** 서버 함수를 그대로 받아 건다. 이 부품은 브라우저에서 도는데, 저장은 서버에서만 일어난다. */
  action: (formData: FormData) => Promise<void>;
  error?: string;
}) {
  const [role, setRole] = useState<Role>('student');

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="role">
            역할
          </label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={input}
          >
            {ROLE_LIST.map((r) => (
              <option key={r} value={r}>
                {ROLES[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="name">
            이름
          </label>
          <input id="name" name="name" required className={input} />
        </div>
        <div>
          <label className={label} htmlFor="login_id">
            아이디
          </label>
          <input
            id="login_id"
            name="login_id"
            required
            autoCapitalize="none"
            spellCheck={false}
            placeholder="영문 소문자·숫자"
            className={input}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="password">
            첫 비밀번호
          </label>
          <input
            id="password"
            name="password"
            required
            minLength={LMS.minPasswordLength}
            placeholder={`${LMS.minPasswordLength}자 이상`}
            className={input}
          />
          {/* 본인이 처음 들어와서 반드시 바꾸므로 여기서는 가리지 않는다 — 불러 줘야 한다. */}
          <p className="mt-1 text-[12px] text-muted">본인이 처음 들어올 때 바꿔요</p>
        </div>
        <div>
          <label className={label} htmlFor="phone">
            연락처
          </label>
          <input id="phone" name="phone" inputMode="tel" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="email">
            이메일
          </label>
          <input id="email" name="email" type="email" className={input} />
          {/* 학생은 답변 PDF 를 받는 주소, 튜터는 학생 답장이 닿는 주소다. 비우면 메일이 안 간다. */}
          <p className="mt-1 text-[12px] text-muted">
            {role === 'student' ? '답변 PDF 가 이 주소로 가요' : role === 'tutor' ? '학생이 답장하면 이 주소로 와요' : '선택'}
          </p>
        </div>
      </div>

      {role === 'student' ? (
        <div className="glass-inset grid gap-3 rounded-xl p-3 sm:grid-cols-4">
          <div>
            <label className={label} htmlFor="grade">
              학년
            </label>
            <select id="grade" name="grade" className={input} defaultValue="">
              <option value="">—</option>
              <option value="1">고1</option>
              <option value="2">고2</option>
              <option value="3">고3</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="school">
              학교
            </label>
            <input id="school" name="school" className={input} />
          </div>
          <div>
            <label className={label} htmlFor="parent_phone">
              학부모 연락처
            </label>
            <input id="parent_phone" name="parent_phone" inputMode="tel" className={input} />
          </div>
          <div>
            <label className={label} htmlFor="receipt_no">
              접수번호
            </label>
            <input id="receipt_no" name="receipt_no" placeholder="F0902-013" className={input} />
            <p className="mt-1 text-[12px] text-muted">시험지 피드백 연결</p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" className={btn}>
          만들기
        </button>
        {error ? (
          <p className="text-[13px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
