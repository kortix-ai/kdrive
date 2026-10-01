'use client';

// Settings → AI agents (MCP.md §14.2): connect an agent (URL + snippets), connected apps, agent tokens.
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AppsList } from '@/components/agents/apps-list';
import { ConnectSection } from '@/components/agents/connect-section';
import { TokenList } from '@/components/agents/token-list';
import { buttonClass } from '@/components/ui/button';
import { useVx } from '@/lib/store';

export default function AgentsSettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pb-16 pt-6 min-[721px]:px-6">
      <div className="mb-2">
        <Link href="/settings" className={buttonClass('text', 'sm', { className: '-ml-3 mb-1' })}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
          Settings
        </Link>
        <h1 className="vx-h1">AI agents</h1>
      </div>
      <ConnectSection />
      <AppsList />
      <TokenList />
    </div>
  );
}
