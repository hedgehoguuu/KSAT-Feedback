import 'server-only';
import nodemailer from 'nodemailer';

/**
 * 메일 보내기. 세 곳이 같은 Gmail SMTP 를 쓴다 — 본문만 각자 쓰고, 보내는 길은 여기 하나다.
 *
 *   접수 확인 메일   intake/worker/mail.ts
 *   신청 알림        class/mail.ts
 *   답변 PDF         lms/mail.ts
 *
 * 예전에는 셋이 계정 읽기 · 공백 지우기 · 타임아웃을 한 벌씩 복사해 들고 있었다. 그러면 언젠가
 * 하나만 고쳐진다.
 *
 * Gmail SMTP 인 이유: 발신 주소를 그대로 쓰려면 이 방법뿐이다 — 외부 발송 서비스는 도메인 인증을
 * 요구하는데 gmail.com 은 우리가 인증할 수 없다. 2단계 인증을 켠 계정에서 발급한 앱 비밀번호가 필요하다.
 */

function credentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER?.trim();
  // 구글은 앱 비밀번호를 'abcd efgh ijkl mnop' 처럼 띄어서 보여준다. 그대로 붙여넣어도 되게 공백을 지운다.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  return user && pass ? { user, pass } : null;
}

/** 메일을 보낼 수 있는가. 보내는 쪽과 같은 기준으로 본다 — 공백만 넣은 비밀번호는 없는 것이다. */
export function mailConfigured(): boolean {
  return credentials() !== null;
}

export type Outgoing = {
  /** 받는 사람 눈에 보이는 보낸 이 이름. 주소는 늘 GMAIL_USER 다. */
  fromName: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

/**
 * 한 통 보낸다. 설정이 없거나 실패하면 던진다 — 부른 쪽이 그 실패를 제자리에 적는다
 * (접수의 sync_failures · 신청의 alert_error · 응시의 mail_error).
 *
 * socketTimeoutMs: 첨부가 큰 메일(답변 PDF)은 조금 더 기다린다.
 */
export async function sendMail(message: Outgoing, opts: { socketTimeoutMs?: number } = {}): Promise<void> {
  const auth = credentials();
  if (!auth) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 가 없습니다');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth,
    // 응답이 없을 때 함수 시간을 다 잡아먹지 않게 끊는다
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: opts.socketTimeoutMs ?? 15_000,
  });

  const { fromName, ...rest } = message;
  await transporter.sendMail({ from: `${fromName} <${auth.user}>`, ...rest });
}
