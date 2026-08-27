import { redirect } from 'next/navigation';

export default async function SchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/analysis/${id}`);
}
