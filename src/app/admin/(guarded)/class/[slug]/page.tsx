import { notFound } from 'next/navigation';
import { ClassForm } from '@/components/ClassForm';
import { requireAdmin } from '@/lib/admin';
import { getClass, signProofUrls } from '@/lib/class/classes';

export const dynamic = 'force-dynamic';

export default async function EditClassPage({ params, searchParams }: PageProps<'/admin/class/[slug]'>) {
  // 레이아웃도 막지만 화면마다 다시 본다 — 레이아웃은 화면 사이를 옮겨 다닐 때 다시 돌지 않는다.
  await requireAdmin();
  const { slug } = await params;
  const { error } = await searchParams;

  const data = await getClass(slug);
  if (!data) notFound();

  const urls = await signProofUrls(data.proof_paths);
  const proofs = data.proof_paths
    .map((path) => ({ path, url: urls.get(path) ?? '' }))
    .filter((p) => p.url);

  return <ClassForm data={data} proofs={proofs} error={typeof error === 'string' ? error : undefined} />;
}
