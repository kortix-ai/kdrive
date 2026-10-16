import { redirect } from 'next/navigation';
import { legacyAdminPath } from '@/components/admin/admin-route';
import { Overview } from '@/components/admin/overview';
import { requireAdminPage } from '@/lib/admin-gate';

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  // Old links (`/admin?tab=requests`, `?tab=users&user=…`, audit filters) go to their section.
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (Array.isArray(v)) for (const x of v) sp.append(k, x);
    else if (v !== undefined) sp.append(k, v);
  }
  const to = legacyAdminPath(sp);
  if (to) redirect(to);
  return <Overview />;
}
