'use client';

import { useRef, useState, useTransition } from 'react';
import { fmtAnswer } from '@/config/lms';
import { normalizeImage } from '@/lib/image';
import type { OcrResult, OcrRow } from '@/lib/lms/ocr-rows';
import { btn, btnGhost } from './Shell';

/**
 * 정답표 사진에서 정답 채우기.
 *
 * 결과를 바로 저장하지 않고 칸에 채워 넣기만 한다. 잘못 읽은 정답이 조용히 저장되는 것이
 * 이 기능에서 가장 나쁜 일이라, 튜터의 눈을 한 번 반드시 거치게 한다.
 * 못 읽은 번호와 두 가지로 읽힌 번호는 숫자로 짚어 준다 — 빈 칸만 보고는 왜 비었는지 모른다.
 */
export function AnswerKeyOcr({
  action,
  examId,
  onRows,
  configured,
}: {
  action: (formData: FormData) => Promise<OcrResult>;
  examId: string;
  onRows: (rows: OcrRow[], mode: 'replace' | 'fill') => void;
  configured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<OcrResult | null>(null);
  const [busy, setBusy] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(files: FileList | null) {
    if (!files || files.length === 0) return;
    setResult(null);

    // 원본 사진은 4000px 넘는 것이 흔하다. 그대로 보내면 서버 함수 상한(6MB)에 걸린다.
    setBusy('사진 줄이는 중…');
    const form = new FormData();
    form.set('exam_id', examId);
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        const shrunk = await normalizeImage(file);
        form.append('photo', new File([shrunk.blob], shrunk.name, { type: 'image/jpeg' }));
      }
    } catch {
      setBusy('');
      setResult({ ok: false, reason: 'NO_IMAGE' });
      return;
    }

    setBusy('읽는 중… 30초쯤 걸려요');
    startTransition(async () => {
      try {
        setResult(await action(form));
      } catch {
        setResult({ ok: false, reason: 'UNKNOWN' });
      }
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  if (!configured) {
    return (
      <p className="text-[13px] leading-[1.6] text-muted">
        사진으로 정답 채우기가 아직 켜져 있지 않아요. Vercel 환경변수에{' '}
        <span className="font-bold">ANTHROPIC_API_KEY</span> 를 넣으면 열려요.
      </p>
    );
  }

  const read = result?.ok ? result.rows.filter((r) => r.answer !== null) : [];

  return (
    <div>
      <p className="mb-3 text-[13px] leading-[1.6] text-muted">
        시험지 뒤의 <span className="font-bold">정답표</span>나 해설지 첫 장을 찍어 올리면 정답을 채워요.
        선택과목이 여럿 적힌 정답표라면 23–30번은 미적분 것만 읽어요. 두 쪽이면 함께 올려주세요 (최대 4장).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className={`${btn} cursor-pointer`}>
          {pending || busy ? busy || '읽는 중…' : '사진 고르기'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={pending || Boolean(busy)}
            onChange={(e) => void run(e.target.files)}
            className="sr-only"
          />
        </label>
        {result?.ok ? (
          <>
            <button type="button" onClick={() => onRows(result.rows, 'replace')} className={btnGhost}>
              읽은 것으로 바꾸기
            </button>
            <button type="button" onClick={() => onRows(result.rows, 'fill')} className={btnGhost}>
              빈 칸만 채우기
            </button>
          </>
        ) : null}
      </div>

      {/* 사진이 밖으로 나간다는 사실은 숨기지 않는다. */}
      <p className="mt-3 text-[12px] leading-[1.6] text-muted">
        사진은 읽는 동안에만 Anthropic 서버로 보내지고 어디에도 저장하지 않아요.
        학생 답안지가 아니라 <span className="font-bold">정답표</span>를 올려주세요.
      </p>

      {result && !result.ok ? (
        <p className="mt-3 rounded-xl bg-mark-soft px-4 py-3 text-[13px] font-bold text-mark" role="alert">
          {MESSAGES[result.reason] ?? MESSAGES.UNKNOWN}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="glass-inset mt-3 rounded-xl p-3">
          <p className="text-[14px] font-bold">{read.length}개 번호의 정답을 읽었어요</p>
          {result.unread.length > 0 ? (
            <p className="mt-1 text-[13px] font-bold text-mark">
              못 읽은 번호 {result.unread.join(', ')} — 직접 넣어주세요.
            </p>
          ) : null}
          {result.conflicts.length > 0 ? (
            <p className="mt-1 text-[13px] font-bold text-mark">
              두 가지로 읽혀서 비워 둔 번호 {result.conflicts.join(', ')}
            </p>
          ) : null}
          {result.note ? <p className="mt-1 text-[13px] leading-[1.6] text-muted">{result.note}</p> : null}
          <p className="mt-2 text-[12px] leading-[1.6] text-muted">
            {read
              .slice(0, 12)
              .map((r) => `${r.no} ${fmtAnswer(r.no, r.answer)}`)
              .join(' · ')}
            {read.length > 12 ? ` … 외 ${read.length - 12}개` : ''}
          </p>
          <p className="mt-2 text-[13px] font-bold">
            아래 칸에 넣은 뒤 <span className="text-mark">반드시 눈으로 확인</span>하고 저장해주세요.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 서버 쪽(ocr.ts)이 돌려주는 코드마다 할 말. 그 파일은 server-only 라 여기서 못 부른다. */
const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: '사진 읽기가 아직 켜져 있지 않아요.',
  NO_IMAGE: '사진을 열 수 없었어요. 다른 사진으로 올려주세요.',
  UNREADABLE: '사진에서 정답표를 못 읽었어요. 번호와 정답이 잘 보이게 다시 찍어주세요.',
  REFUSED: '이 사진은 읽지 못했어요. 정답을 직접 넣어주세요.',
  BAD_KEY: 'API 키가 맞지 않아요. 관리자에게 알려주세요.',
  RATE_LIMIT: '지금은 요청이 몰렸어요. 잠시 뒤에 다시 해주세요.',
  API_ERROR: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
  UNKNOWN: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
};
