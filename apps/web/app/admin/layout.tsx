import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/admin/console-shell';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Admin · KDRIVE' }, robots: { index: false, follow: false } };

// The admin console: its own frame, apart from the drive. The API is asked who is signed in
// before anything renders; everyone but an admin gets the app's normal 404.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return <ConsoleShell admin={admin}>{children}</ConsoleShell>;
}
