'use client';

// Settings (DESIGN.md 6.17): profile, appearance, storage, workspaces, activity, shortcuts, session, danger zone.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { LogOut } from 'lucide-react';
import { ActivitySection } from '@/components/settings/activity-section';
import { DangerZone } from '@/components/settings/danger-zone';
import { ProfileSection } from '@/components/settings/profile-section';
import { Section } from '@/components/settings/section';
import { StorageSection } from '@/components/settings/storage-section';
import { WorkspacesSection } from '@/components/settings/workspaces-section';
import { ShortcutSheet } from '@/components/shell/shortcut-sheet';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Segmented } from '@/components/ui/segmented';
import { signOut } from '@/lib/auth-client';
import { useVx } from '@/lib/store';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

function AppearanceSection() {
  const [theme, set] = useState<Theme>('dark');
  useEffect(() => {
    set(getTheme());
    const on = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener('vx-theme', on);
    return () => window.removeEventListener('vx-theme', on);
  }, []);
  return (
    <Section id="appearance" label="Appearance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="vx-name text-vx-text-1">Theme</div>
          <p className="vx-micro mt-0.5 text-vx-text-4">Dark is the default. Your choice is kept on this device.</p>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => setTheme(t)}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </div>
    </Section>
  );
}

function ShortcutsSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section id="shortcuts" label="Shortcuts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vx-body text-vx-text-3">
          Everything has a key. Press <Kbd>?</Kbd> anywhere to see them.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} kbd="?">
          Show shortcuts
        </Button>
      </div>
      <ShortcutSheet open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}

function SessionSection() {
  const router = useRouter();
  const setMe = useVx((s) => s.setMe);
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true);
    await signOut().catch(() => {});
    setMe(null);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace('/signin');
  };
  return (
    <Section id="session" label="Session">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vx-body text-vx-text-3">Signs you out on this device. Your files stay where they are.</p>
        <Button icon={<LogOut size={14} />} onClick={() => void out()} loading={busy}>
          Sign out
        </Button>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const me = useVx((s) => s.me);
  if (!me) return null;
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 className="vx-h1">Settings</h1>
      <ProfileSection me={me} />
      <AppearanceSection />
      <StorageSection fallback={me.usage} />
      <WorkspacesSection />
      <ActivitySection />
      <ShortcutsSection />
      <SessionSection />
      <DangerZone me={me} />
      <div className="h-8" />
    </div>
  );
}
