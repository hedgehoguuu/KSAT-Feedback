import { NextResponse, after } from 'next/server';
import { isPhone, isReceiptNo, normalizePhone, normalizeReceiptNo } from '@/config/class';
import { ApplyError, applyToClass, getClass, markApplicationAlert } from '@/lib/classes';
import { sendApplicationAlert } from '@/lib/class-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  slug?: string;
  studentName?: string;
  receiptNo?: string;
  parentPhone?: string;
  consent?: boolean;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad('invalid json');
  }

  const slug = body.slug?.trim() ?? '';
  const studentName = body.studentName?.trim() ?? '';
  const parentPhone = normalizePhone(body.parentPhone ?? '');
  // 접수번호는 형식이 틀려도 받는다. 대조 실패는 관리자 목록에서 사람이 확인한다 —
  // 번호 하나 때문에 신청을 놓치는 쪽이 더 나쁘다.
  const receiptNo = normalizeReceiptNo(body.receiptNo ?? '');

  if (!slug) return bad('반을 찾을 수 없어요');
  if (studentName.length < 1 || studentName.length > 30) return bad('학생 이름을 적어주세요');
  // 화면의 maxLength 는 브라우저에서만 도는 안내다. 형식은 안 따지되 길이는 여기서 막는다.
  if (receiptNo.length > 32) return bad('접수번호를 다시 확인해주세요');
  if (!isPhone(parentPhone)) return bad('학부모 연락처를 다시 확인해주세요');
  if (body.consent !== true) return bad('개인정보 수집·이용 동의가 필요해요');

  const target = await getClass(slug);
  if (!target || target.status !== 'open') return bad('지금 신청을 받고 있지 않은 반이에요', 409);
  if (target.full) return bad('자리가 다 찼어요', 409);

  let applicationId: string;
  try {
    applicationId = await applyToClass({ slug, studentName, receiptNo, parentPhone });
  } catch (err) {
    if (err instanceof ApplyError) return bad(err.message, err.code === 'UNKNOWN' ? 500 : 409);
    return bad('신청이 안 됐어요. 다시 눌러주세요.', 500);
  }

  /**
   * 알림 메일이 늦어도 학생은 기다리지 않는다. 실패해도 신청은 이미 들어와 있다.
   *
   * 그리고 갔는지 안 갔는지를 신청 행에 적는다. 예전에는 실패가 서버 로그 한 줄로만
   * 남았는데, 그러면 "메일이 안 왔으니 신청도 없겠지" 라는 오해를 아무도 못 깬다.
   * 이제 /admin/applications 에서 그 신청 옆에 빨갛게 뜬다.
   */
  after(async () => {
    // 기록은 성공이든 실패든 딱 한 번, 보내기 바깥에서 한다.
    // 안에서 부르면 '기록이 실패한 것' 이 '메일이 실패한 것' 으로 둔갑한다.
    let reason: string | null = null;
    try {
      await sendApplicationAlert({
        classTitle: target.title,
        classSlug: target.slug,
        studentName,
        receiptNo,
        parentPhone,
        seatsLeft: Math.max(0, target.seatsLeft - 1),
        capacity: target.capacity,
      });
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
      console.error('[class-apply] 알림 메일 실패', err);
    }
    await markApplicationAlert(applicationId, reason);
  });

  return NextResponse.json({
    ok: true,
    receiptShapeOk: receiptNo === '' ? null : isReceiptNo(receiptNo),
  });
}
