'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useSyncExternalStore } from 'react';
import type { ExamCode } from '@/config/exams';
import { findExam } from '@/config/exams';
import type { SubjectCode } from '@/config/subjects';
import { uid } from './id';

export type PhotoStatus = 'queued' | 'uploading' | 'done' | 'error';

export type Photo = {
  id: string;
  subject: SubjectCode;
  name: string;
  bytes: number;
  status: PhotoStatus;
  /** 0–100 */
  progress: number;
  /** 업로드가 끝난 뒤의 스토리지 경로 */
  storagePath?: string;
  /** 브라우저 세션 동안만 유효한 미리보기 URL (localStorage 에 저장하지 않는다) */
  previewUrl?: string;
  error?: string;
};

export type Receipt = {
  receiptNo: string;
  email: string;
  dueDate: string;
  examCode: ExamCode;
  subjects: { code: SubjectCode; photoCount: number }[];
};

type State = {
  examCode: ExamCode | null;
  subjects: SubjectCode[];
  photos: Photo[];
  concerns: Partial<Record<SubjectCode, Record<string, string>>>;
  email: string;
  consent: boolean;
  ageOk: boolean;
  /** 마지막으로 머문 경로 — 이어하기(FE-8) */
  lastPath: string | null;
  /** 제출 멱등키. 재시도해도 접수는 1건이다 (BE-2) */
  submitKey: string | null;
  updatedAt: number | null;
  receipt: Receipt | null;
  /**
   * 방금 제출을 끝냈다는 표시. 저장하지 않는다.
   * 제출 직후에는 입력값이 비므로, 이 표시가 없으면 ①단계로 되돌리는 가드가 완료 화면을 가로챈다.
   */
  justCompleted: boolean;
};

type Actions = {
  setExam: (code: ExamCode) => void;
  toggleSubject: (code: SubjectCode) => void;
  addPhotos: (subject: SubjectCode, items: { name: string; bytes: number; previewUrl: string }[]) => Photo[];
  patchPhoto: (id: string, patch: Partial<Photo>) => void;
  removePhoto: (id: string) => void;
  movePhoto: (id: string, dir: -1 | 1) => void;
  setConcern: (subject: SubjectCode, questionId: string, value: string) => void;
  setEmail: (v: string) => void;
  setConsent: (v: boolean) => void;
  setAgeOk: (v: boolean) => void;
  markPath: (path: string) => void;
  ensureSubmitKey: () => string;
  /** 제출 성공 — 접수 결과만 남기고 입력분은 지운다 (FE-8 AC) */
  complete: (r: Receipt) => void;
  reset: () => void;
};

const EMPTY: State = {
  examCode: null,
  subjects: [],
  photos: [],
  concerns: {},
  email: '',
  consent: false,
  ageOk: false,
  lastPath: null,
  submitKey: null,
  updatedAt: null,
  receipt: null,
  justCompleted: false,
};

const touch = () => ({ updatedAt: Date.now() });

export const useApply = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      setExam: (code) =>
        set((s) => {
          if (s.examCode === code) return s;
          const allowed = new Set(findExam(code)?.subjects ?? []);
          // 시험을 바꾸면 사라진 과목의 업로드·고민도 함께 정리한다 (FE-1 AC)
          const subjects = s.subjects.filter((x) => allowed.has(x));
          const photos = s.photos.filter((p) => allowed.has(p.subject));
          const concerns = Object.fromEntries(
            Object.entries(s.concerns).filter(([k]) => allowed.has(k as SubjectCode)),
          );
          return { ...s, examCode: code, subjects, photos, concerns, ...touch() };
        }),

      toggleSubject: (code) =>
        set((s) => {
          const on = s.subjects.includes(code);
          if (on) {
            return {
              ...s,
              subjects: s.subjects.filter((x) => x !== code),
              photos: s.photos.filter((p) => p.subject !== code),
              concerns: Object.fromEntries(Object.entries(s.concerns).filter(([k]) => k !== code)),
              ...touch(),
            };
          }
          return { ...s, subjects: [...s.subjects, code], ...touch() };
        }),

      addPhotos: (subject, items) => {
        const created: Photo[] = items.map((it) => ({
          id: uid(),
          subject,
          name: it.name,
          bytes: it.bytes,
          status: 'queued',
          progress: 0,
          previewUrl: it.previewUrl,
        }));
        set((s) => ({ ...s, photos: [...s.photos, ...created], ...touch() }));
        return created;
      },

      patchPhoto: (id, patch) =>
        set((s) => ({
          ...s,
          photos: s.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          ...touch(),
        })),

      removePhoto: (id) =>
        set((s) => ({ ...s, photos: s.photos.filter((p) => p.id !== id), ...touch() })),

      movePhoto: (id, dir) =>
        set((s) => {
          const target = s.photos.find((p) => p.id === id);
          if (!target) return s;
          const sameSubject = s.photos.filter((p) => p.subject === target.subject);
          const at = sameSubject.indexOf(target);
          const to = at + dir;
          if (to < 0 || to >= sameSubject.length) return s;
          const reordered = [...sameSubject];
          reordered.splice(at, 1);
          reordered.splice(to, 0, target);
          // 다른 과목의 순서는 건드리지 않고 해당 과목 자리만 교체한다
          let i = 0;
          const photos = s.photos.map((p) => (p.subject === target.subject ? reordered[i++] : p));
          return { ...s, photos, ...touch() };
        }),

      setConcern: (subject, questionId, value) =>
        set((s) => ({
          ...s,
          concerns: { ...s.concerns, [subject]: { ...(s.concerns[subject] ?? {}), [questionId]: value } },
          ...touch(),
        })),

      setEmail: (v) => set((s) => ({ ...s, email: v, ...touch() })),
      setConsent: (v) => set((s) => ({ ...s, consent: v, ...touch() })),
      setAgeOk: (v) => set((s) => ({ ...s, ageOk: v, ...touch() })),
      markPath: (path) => set((s) => (s.lastPath === path ? s : { ...s, lastPath: path })),

      ensureSubmitKey: () => {
        const found = get().submitKey;
        if (found) return found;
        const next = uid();
        set((s) => ({ ...s, submitKey: next }));
        return next;
      },

      complete: (r) => {
        get().photos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        set({ ...EMPTY, receipt: r, justCompleted: true, updatedAt: Date.now() });
      },

      reset: () => {
        get().photos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        set({ ...EMPTY });
      },
    }),
    {
      name: 'ksat-feedback:apply:v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // previewUrl 은 새로고침하면 죽는 objectURL 이라 저장하지 않는다
      partialize: (s) => ({
        examCode: s.examCode,
        subjects: s.subjects,
        photos: s.photos.map((p) => ({
          id: p.id,
          subject: p.subject,
          name: p.name,
          bytes: p.bytes,
          status: p.status,
          progress: p.progress,
          storagePath: p.storagePath,
          error: p.error,
        })),
        concerns: s.concerns,
        email: s.email,
        consent: s.consent,
        ageOk: s.ageOk,
        lastPath: s.lastPath,
        submitKey: s.submitKey,
        updatedAt: s.updatedAt,
        receipt: s.receipt,
      }),
    },
  ),
);

/** persist 복원이 끝났는지. 서버 렌더 결과와 어긋나지 않게 렌더를 미루는 데 쓴다. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useApply.persist?.onFinishHydration(onChange) ?? (() => {}),
    // localStorage 가 없으면 persist 자체가 안 붙는다 (사파리 프라이빗 등) — 그때는 바로 통과시킨다
    () => useApply.persist?.hasHydrated() ?? true,
    // 서버에서는 저장분을 모르니 항상 '아직'
    () => false,
  );
}

export function photosOf(photos: Photo[], subject: SubjectCode): Photo[] {
  return photos.filter((p) => p.subject === subject);
}

/** 진행 중인 접수가 남아 있는지 (이어하기 배너 노출 조건) */
export function hasProgress(s: State): boolean {
  return !s.receipt && (s.examCode !== null || s.photos.length > 0 || s.email.length > 0);
}
