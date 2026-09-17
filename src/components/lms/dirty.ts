'use client';

/**
 * 이 화면에 저장하지 않은 손질이 있는가. 채점표(GradeSheet)가 적고, 사진 읽기를 기다리는
 * 부품(ReadWatcher)이 본다 — 읽기가 끝났다고 화면을 새로 그리면 매기던 칸이 날아간다.
 *
 * 한 화면에 채점표는 하나라서 모듈 변수 하나로 충분하다.
 */
let dirty = false;

export function setDirty(value: boolean): void {
  dirty = value;
}

export function isDirty(): boolean {
  return dirty;
}
