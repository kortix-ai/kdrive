'use client';

// Settings → Storage (UNIFY-SPEC §14.4): the settings sheet with the breakdown by kind of file, the largest
// files, version history and who is using the space in shared drives.
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { SettingsSheet } from '@/components/settings/settings-sheet';
import { HistorySection, LargestFilesSection, SharedPeopleSection, StorageOverviewSection } from '@/components/settings/storage-insights';
import { buttonClass } from '@/components/ui/button';
import { useVx } from '@/lib/store';

export default function StorageSettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <SettingsSheet
      title="Storage"
      back={
        <Link href="/settings" className={buttonClass('text', 'sm', { className: '-ml-2 !px-2 text-vx-text-2' })}>
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
          Settings
        </Link>
      }
    >
      <StorageOverviewSection />
      <LargestFilesSection />
      <HistorySection />
      <SharedPeopleSection />
    </SettingsSheet>
  );
}
