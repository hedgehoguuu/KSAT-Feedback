import 'server-only';
import nodemailer from 'nodemailer';
import { SUBJECT } from '@/config/lms';
import { siteUrl } from '@/lib/site';

export type FeedbackMail = {
  to: string;
  /** 학생이 답장하면 튜터에게 가게 한다. 튜터 메일이 없으면 보낸 주소로 간다. */
  replyTo: string | null;
  studentName: string;
  tutorName: string | null;
  courseName: string;
  examId: string;
  examTitle: string;
  concernCount: number;
  pdf: Uint8Array;
};

/** 첨부 이름. 윈도우가 못 쓰는 글자만 뺀다 — 한글은 nodemailer 가 알아서 감싼다. */
export function feedbackFileName(examTitle: string, studentName: string): string {
  return `${examTitle} 답변 - ${studentName}.pdf`.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ');
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * 답변 PDF 를 학생에게 보낸다.
 *
 * 접수 확인 메일(worker/mail.ts) · 신청 알림(class-mail.ts)과 같은 Gmail SMTP 다.
 * 실패하면 던진다 — 부른 쪽이 그 사실을 응시 행에 적는다 (mail_error).
 */
export async function sendFeedbackMail(input: FeedbackMail): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  // 구글은 앱 비밀번호를 'abcd efgh ijkl mnop' 처럼 띄어서 보여준다. 그대로 붙여넣어도 되게 공백을 지운다.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 가 없습니다');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  // 로컬에서는 도메인이 없어서 상대 경로만 남는다.
  const link = `${siteUrl() ?? ''}/lms/me/exams/${input.examId}`;
  const who = input.tutorName ? `${input.tutorName} 선생님` : '선생님';

  const text = [
    `${input.studentName} 학생, 안녕하세요.`,
    '',
    `${input.examTitle} 시험 뒤에 남긴 질문 ${input.concernCount}개에 ${who}이 답을 달았어요.`,
    '질문과 답을 한데 모은 PDF 를 첨부했어요. 다음 수업 전에 한 번 읽어 와 주세요.',
    '',
    `성적 관리 화면에서도 다시 받을 수 있어요 — ${link}`,
    '',
    `${input.courseName} · ${SUBJECT.course}`,
  ].join('\n');

  const html = `<div style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
    <p style="margin:0;font-size:13px;font-weight:700;color:#3182f6">${escape(SUBJECT.course)} · 질문 답변</p>
    <h1 style="margin:8px 0 0;font-size:21px;line-height:1.4;color:#191f28">질문 ${input.concernCount}개에 답을 달았어요</h1>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#4e5968">
      ${escape(input.studentName)} 학생, <strong style="color:#191f28">${escape(input.examTitle)}</strong> 시험 뒤에 남긴 질문에
      ${escape(who)}이 답을 달았어요. 질문과 답을 한데 모은 PDF 를 첨부했어요.
    </p>
    <p style="margin:22px 0 0">
      <a href="${escape(link)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#3182f6;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">성적 관리에서 보기</a>
    </p>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#8b95a1">${escape(input.courseName)}</p>
  </div>
</div>`;

  await transporter.sendMail({
    from: `${SUBJECT.course} <${user}>`,
    to: input.to,
    replyTo: input.replyTo ?? undefined,
    subject: `[답변] ${input.examTitle} — 남긴 질문 ${input.concernCount}개에 답을 달았어요`,
    text,
    html,
    attachments: [
      {
        filename: feedbackFileName(input.examTitle, input.studentName),
        content: Buffer.from(input.pdf),
        contentType: 'application/pdf',
      },
    ],
  });
}
