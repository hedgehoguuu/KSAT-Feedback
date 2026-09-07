'use client';

import { useRef, useState, useTransition } from 'react';
import { LMS, areaLabel } from '@/config/lms';
import { normalizeImage } from '@/lib/image';
import type { OcrResult, OcrRow } from '@/lib/lms/ocr';
import { btn, btnGhost } from './Shell';

/**
 * 정답표·배점표 사진에서 문항표 초안 만들기.
 *
 * 결과를 바로 저장하지 않고 편집기에 채워 넣기만 한다. 잘못 읽은 값이 조용히 저장되는
 * 것이 이 기능에서 가장 나쁜 일이라, 튜터의 눈을 한 번 반드시 거치게 한다.
 *
 * 사진에서 영역을 못 읽은 줄은 통상 배치로 메워지는데, 그건 '읽은 것'이 아니라
 * '짐작한 것'이므로 몇 줄이 그런지 숫자로 말해 준다.
 */
export function QuestionOcr({
  action,
  examId,
  count,
  onRows,
  configured,
}: {
  action: (formData: FormData) => Promise<OcrResult>;
  examId: string;
  count: number;
  onRows: (rows: OcrRow[], mode: 'replace' | 'merge') => void;
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
    form.set('count', String(count));
    for (const file of Array.from(files).slice(0, 4)) {
      const shrunk = await normalizeImage(file);
      form.append('photo', new File([shrunk.blob], shrunk.name, { type: 'image/jpeg' }));
    }

    setBusy('읽는 중… 30초쯤 걸려요');
    startTransition(async () => {
      const out = await action(form);
      setResult(out);
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    });
  }

  if (!configured) {
    return (
      <p className="text-[13px] leading-[1.6] text-muted">
        사진으로 문항표 만들기가 아직 켜져 있지 않아요. Vercel 환경변수에{' '}
        <span className="font-bold">ANTHROPIC_API_KEY</span> 를 넣으면 열려요.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[13px] leading-[1.6] text-muted">
        시험지 뒤의 <span className="font-bold">정답표나 배점표</span>를 찍어 올리면 초안을 만들어요.
        두 쪽으로 나뉘어 있으면 함께 올려주세요 (최대 4장).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className={`${btn} cursor-pointer`}>
          {pending || busy ? (busy || '읽는 중…') : '사진 고르기'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={pending}
            onChange={(e) => void run(e.target.files)}
            className="sr-only"
          />
        </label>
        {result?.ok ? (
          <>
            <button type="button" onClick={() => onRows(result.rows, 'replace')} className={btnGhost}>
              읽은 것으로 전부 바꾸기
            </button>
            <button type="button" onClick={() => onRows(result.rows, 'merge')} className={btnGhost}>
              빈 곳만 채우기
            </button>
          </>
        ) : null}
      </div>

      {/* 사진이 밖으로 나간다는 사실은 숨기지 않는다. */}
      <p className="mt-3 text-[12px] leading-[1.6] text-muted">
        사진은 읽는 동안에만 Anthropic 서버로 보내지고 어디에도 저장하지 않아요.
        학생 답안지가 아니라 <span className="font-bold">정답표·배점표</span>를 올려주세요.
      </p>

      {result && !result.ok ? (
        <p className="mt-3 rounded-xl bg-mark-soft px-4 py-3 text-[13px] font-bold text-mark" role="alert">
          {MESSAGES[result.reason] ?? MESSAGES.UNKNOWN}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="glass-inset mt-3 rounded-xl p-3">
          <p className="text-[14px] font-bold">
            {result.rows.length}줄을 읽었어요
            {result.guessedCount > 0 ? (
              <span className="ml-1.5 font-bold text-mark">
                · 그중 {result.guessedCount}줄은 영역을 못 읽어 통상 배치로 채웠어요
              </span>
            ) : null}
          </p>
          {result.note ? <p className="mt-1 text-[13px] leading-[1.6] text-muted">{result.note}</p> : null}

          <p className="mt-2 text-[12px] leading-[1.6] text-muted">
            {result.rows
              .slice(0, 8)
              .map((r) => `${r.no}${r.areaGuessed ? '?' : ''} ${areaLabel(r.area_code)}`)
              .join(' · ')}
            {result.rows.length > 8 ? ` … 외 ${result.rows.length - 8}줄` : ''}
          </p>
          <p className="mt-2 text-[13px] font-bold">
            아래 표에 넣은 뒤 <span className="text-mark">반드시 눈으로 확인</span>하고 저장해주세요.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** ocr.ts 의 OCR_MESSAGES 와 같은 내용. 그 파일은 server-only 라 여기서 못 부른다. */
const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: '사진 읽기가 아직 켜져 있지 않아요.',
  NO_IMAGE: '사진을 한 장 이상 올려주세요.',
  UNREADABLE: '사진에서 문항표를 못 읽었어요. 정답표나 배점표가 잘 보이게 다시 찍어주세요.',
  BAD_KEY: 'API 키가 맞지 않아요. 관리자에게 알려주세요.',
  RATE_LIMIT: '지금은 요청이 몰렸어요. 잠시 뒤에 다시 해주세요.',
  API_ERROR: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
  UNKNOWN: '사진 읽기가 실패했어요. 잠시 뒤에 다시 해주세요.',
};

export const OCR_MAX_ROWS = LMS.maxQuestionCount * 2;
