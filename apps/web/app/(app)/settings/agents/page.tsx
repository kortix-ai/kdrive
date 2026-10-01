'use client';

// Settings → AI agents (UNIFY-SPEC §14.4): the settings sheet with connect, connected apps and agent tokens.
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AppsList } from '@/components/agents/apps-list';
import { ConnectSection } from '@/components/agents/connect-section';
import { TokenList } from '@/components/agents/token-list';
import { SettingsSheet } from '@/components/settings/settings-sheet';
import { buttonClass } from '@/components/ui/button';
import { useVx } from '@/lib/store';

export default function AgentsSettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <SettingsSheet
      title="AI agents"
      back={
        <Link href="/settings" className={buttonClass('text', 'sm', { className: '-ml-2 !px-2 text-vx-text-2' })}>
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
          Settings
        </Link>
      }
    >
      <ConnectSection />
      <AppsList />
      <TokenList />
    </SettingsSheet>
  );
}
