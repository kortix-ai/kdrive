import type { Metadata } from 'next';
import { UserSection } from '@/components/admin/sections';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'User' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  return <UserSection userId={id} />;
}
