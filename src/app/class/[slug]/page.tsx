import { notFound, redirect } from 'next/navigation';
import { getClass } from '@/lib/classes';

export const dynamic = 'force-dynamic';

/**
 * 반 하나의 주소.
 *
 * 관리자 화면이 이 주소를 "이 반의 주소" 로 안내하고 있어서, 카카오톡에 붙여 보내는
 * 링크가 된다. 그런데 이 자리에 아무것도 없어서 404 였다 — 안내한 주소가 깨져 있었다.
 *
 * 신청 화면이 반 정보를 먼저 보여주고 그 아래에 폼이 있으므로 그리로 보낸다.
 * 신청서 주소를 하나로 유지해, 링크가 여러 갈래로 흩어지지 않게 한다.
 */
export default async function ClassPermalink({ params }: PageProps<'/class/[slug]'>) {
  const { slug } = await params;
  if (!(await getClass(slug))) notFound();
  redirect(`/class/${slug}/apply`);
}
