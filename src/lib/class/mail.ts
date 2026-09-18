import 'server-only';
import { BRANDING } from '@/config/app';
import { sendMail } from '@/lib/mail';
import { siteUrl } from '@/lib/site';

export type ApplicationAlert = {
  classTitle: string;
  classSlug: string;
  studentName: string;
  receiptNo: string;
  parentPhone: string;
  seatsLeft: number;
  capacity: number;
};

/**
 * 신청이 들어오면 팀에게 알린다 (모집 페이지 PRD §06).
 * 학생에게는 메일을 보내지 않는다 — 연락은 남겨 준 번호로 카카오톡이다.
 *
 * 보내는 길은 lib/mail.ts 에 있다 — 접수 확인 메일 · 답변 PDF 와 같은 Gmail SMTP 다.
 */
export async function sendApplicationAlert(input: ApplicationAlert): Promise<void> {
  // 로컬에서는 도메인이 없어서 상대 경로만 남는다.
  const site = siteUrl() ?? '';

  const lines = [
    `반 — ${input.classTitle}`,
    `학생 — ${input.studentName}`,
    `9모 접수번호 — ${input.receiptNo || '(안 적음)'}`,
    `학부모 연락처 — ${input.parentPhone}`,
    `남은 자리 — ${input.capacity}자리 중 ${input.seatsLeft}자리`,
    '',
    '학부모 연락처로 카카오톡을 보내고, 관리자 화면에서 상태를 옮겨주세요.',
    '',
    `신청자 목록 — ${site}/admin/applications`,
  ];

  await sendMail({
    fromName: BRANDING.serviceName,
    to: BRANDING.contactEmail,
    subject: `[신청] ${input.classTitle} · ${input.studentName} (${input.parentPhone})`,
    text: lines.join('\n'),
  });
}
