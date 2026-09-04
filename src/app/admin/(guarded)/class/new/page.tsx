import { ClassForm } from '@/components/ClassForm';

export const dynamic = 'force-dynamic';

export default async function NewClassPage({ searchParams }: PageProps<'/admin/class/new'>) {
  const { error } = await searchParams;
  return <ClassForm data={null} proofs={[]} error={typeof error === 'string' ? error : undefined} />;
}
