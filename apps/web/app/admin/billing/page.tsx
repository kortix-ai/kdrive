import type { Metadata } from 'next';
import { BillingSection } from '@/components/admin/sections';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Billing' };

export default async function Page() {
  await requireAdminPage();
  return <BillingSection />;
}
