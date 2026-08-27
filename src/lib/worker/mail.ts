import 'server-only';
import nodemailer from 'nodemailer';
import { BRANDING, POLICY } from '@/config/app';
import type { Exam } from '@/config/exams';
import { subjectLabel, type SubjectCode } from '@/config/subjects';

export type MailInput = {
  receiptNo: string;
  to: string;
  dueDate: string;
  exam: Exam;
  subjects: { code: SubjectCode; photoCount: number }[];
};

export function mailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * 접수 확인 메일 (P1-1).
 *
 * Gmail SMTP 로 보낸다. 발신 주소를 그대로 쓰려면 이 방법뿐이다 —
 * 외부 발송 서비스는 도메인 인증을 요구하는데 gmail.com 은 우리가 인증할 수 없다.
 * 2단계 인증을 켠 계정에서 발급한 앱 비밀번호가 필요하다.
 */
export async function sendConfirmationMail(input: MailInput): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  // 구글은 앱 비밀번호를 'abcd efgh ijkl mnop' 처럼 띄어서 보여준다. 그대로 붙여넣어도 되게 공백을 지운다.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 가 없습니다');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  const summary = input.subjects
    .map((s) => `${subjectLabel(s.code)} ${s.photoCount}장`)
    .join(' · ');

  await transporter.sendMail({
    from: `${BRANDING.serviceName} <${user}>`,
    to: input.to,
    subject: `[접수완료] ${input.receiptNo} · ${input.dueDate}까지 보내드릴게요`,
    text: textBody(input, summary),
    html: htmlBody(input, summary),
  });
}

function textBody(input: MailInput, summary: string): string {
  return [
    '시험지 잘 받았어요.',
    '',
    `접수번호  ${input.receiptNo}`,
    `시험      ${input.exam.shortLabel}`,
    `보내주신 것  ${summary}`,
    `회신 예정일  ${input.dueDate}`,
    '',
    `${input.dueDate}까지 이 메일 주소로 분석 결과를 보내드릴게요.`,
    '형·누나들이 시험지를 직접 넘겨보면서 씁니다. 조금만 기다려주세요.',
    '',
    `보내주신 시험지 사진은 분석이 끝나고 ${POLICY.retentionDays}일 뒤에 지워요.`,
    '문의할 일이 생기면 이 메일에 그대로 답장하면서 접수번호를 알려주세요.',
  ].join('\n');
}

function htmlBody(input: MailInput, summary: string): string {
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 16px 6px 0;color:#8b95a1;font-size:14px;white-space:nowrap">${label}</td>
       <td style="padding:6px 0;font-size:14px;font-weight:600;color:#191f28">${value}</td>
     </tr>`;

  return `<div style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
    <h1 style="margin:0;font-size:22px;line-height:1.4;color:#191f28">시험지 잘 받았어요</h1>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#4e5968">
      <strong style="color:#191f28">${input.dueDate}</strong>까지 이 주소로 분석 결과를 보내드릴게요.
      형·누나들이 시험지를 직접 넘겨보면서 씁니다.
    </p>

    <table style="margin:22px 0 0;border-collapse:collapse">
      ${row('접수번호', input.receiptNo)}
      ${row('시험', input.exam.shortLabel)}
      ${row('보내주신 것', summary)}
      ${row('회신 예정일', input.dueDate)}
    </table>

    <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#8b95a1">
      보내주신 시험지 사진은 분석이 끝나고 ${POLICY.retentionDays}일 뒤에 지워요.<br>
      문의할 일이 생기면 이 메일에 그대로 답장하면서 접수번호를 알려주세요.
    </p>
  </div>
</div>`;
}
