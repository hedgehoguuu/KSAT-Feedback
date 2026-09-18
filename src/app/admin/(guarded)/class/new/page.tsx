import { ClassForm } from '@/components/ClassForm';
import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function NewClassPage({ searchParams }: PageProps<'/admin/class/new'>) {
  // 레이아웃도 막지만 화면마다 다시 본다 — 레이아웃은 화면 사이를 옮겨 다닐 때 다시 돌지 않는다.
  await requireAdmin();
  const { error } = await searchParams;
  return <ClassForm data={null} proofs={[]} error={typeof error === 'string' ? error : undefined} />;
}
