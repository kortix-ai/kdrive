'use client';

// Settings (UNIFY-SPEC §14.4): one sheet, a 720 column; profile, account, appearance, storage, workspaces, agents,
// activity, shortcuts, session and the danger zone as hairline-separated blocks.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { AccountSection } from '@/components/settings/account-section';
import { ActivitySection } from '@/components/settings/activity-section';
import { AgentsCard } from '@/components/settings/agents-card';
import { AppearanceSection } from '@/components/settings/appearance-section';
import { DangerZone } from '@/components/settings/danger-zone';
import { ProfileSection } from '@/components/settings/profile-section';
import { Section } from '@/components/settings/section';
import { SettingsSheet } from '@/components/settings/settings-sheet';
import { StorageSection } from '@/components/settings/storage-section';
import { WorkspacesSection } from '@/components/settings/workspaces-section';
import { ShortcutList } from '@/components/shell/shortcut-sheet';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { signOutAndEnd } from '@/lib/session';
import { useVx } from '@/lib/store';

function ShortcutsSection() {
  return (
    <Section
      id="shortcuts"
      label="Shortcuts"
      description={
        <>
          Everything has a key. Press <Kbd>?</Kbd> anywhere to see them.
        </>
      }
    >
      <ShortcutList />
    </Section>
  );
}

function SessionSection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true);
    // The same session end as the account menu: uploads, prompts, store and every cache.
    await signOutAndEnd();
    router.replace('/signin');
  };
  return (
    <Section
      id="session"
      label="Session"
      description="Signs you out on this device. Your files stay where they are."
      aside={
        <Button variant="outline" icon={<LogOut size={16} strokeWidth={1.75} aria-hidden />} onClick={() => void out()} loading={busy}>
          Sign out
        </Button>
      }
    />
  );
}

export default function SettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <SettingsSheet title="Settings">
      <ProfileSection me={me} />
      <AccountSection me={me} />
      <AppearanceSection />
      <StorageSection fallback={me.usage} />
      <WorkspacesSection />
      <AgentsCard />
      <ActivitySection />
      <ShortcutsSection />
      <SessionSection />
      <DangerZone me={me} />
    </SettingsSheet>
  );
}
