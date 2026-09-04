import 'server-only';
import nodemailer from 'nodemailer';
import { BRANDING } from '@/config/app';

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
 * 접수 확인 메일(worker/mail.ts)과 같은 Gmail SMTP 를 쓴다.
 */
export async function sendApplicationAlert(input: ApplicationAlert): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 가 없습니다');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const lines = [
    `반 — ${input.classTitle}`,
    `학생 — ${input.studentName}`,
    `9모 접수번호 — ${input.receiptNo || '(안 적음)'}`,
    `학부모 연락처 — ${input.parentPhone}`,
    `남은 자리 — ${input.capacity}자리 중 ${input.seatsLeft}자리`,
    '',
    '학부모 연락처로 카카오톡을 보내고, 관리자 화면에서 상태를 옮겨주세요.',
    '',
    '신청자 목록 — /admin/applications',
  ];

  await transporter.sendMail({
    from: `${BRANDING.serviceName} <${user}>`,
    to: BRANDING.contactEmail,
    subject: `[신청] ${input.classTitle} · ${input.studentName} (${input.parentPhone})`,
    text: lines.join('\n'),
  });
}
