import { notFound } from 'next/navigation';
import { ClassForm } from '@/components/ClassForm';
import { getClass, signProofUrls } from '@/lib/classes';

export const dynamic = 'force-dynamic';

export default async function EditClassPage({ params, searchParams }: PageProps<'/admin/class/[slug]'>) {
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
