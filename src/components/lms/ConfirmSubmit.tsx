'use client';

import type { ReactNode } from 'react';

/**
 * 되돌릴 수 없는 것을 누르기 전에 한 번 묻는다.
 *
 * 반을 지우면 그 반의 회차와 채점이 함께 사라지고, 문항표를 새로 깔면 매겨 둔 O/X 가
 * 전부 없어진다. 이런 버튼이 확인 없이 바로 실행되면 되돌릴 방법이 없다 —
 * 되돌리기를 만드는 것보다 한 번 묻는 쪽이 훨씬 싸다.
 *
 * 무엇이 함께 사라지는지를 문구에 적는다. "정말 삭제하시겠습니까?" 는 아무 정보가 없어서
 * 아무도 안 읽고 확인을 누른다.
 *
 * 자바스크립트가 죽으면 확인 없이 그냥 제출된다. 예전과 같은 동작이라 더 나빠지진 않는다.
 */
export function ConfirmSubmit({
  message,
  className,
  children,
  name,
  value,
  disabled,
}: {
  message: string;
  className?: string;
  children: ReactNode;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
