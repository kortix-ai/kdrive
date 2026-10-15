'use client';

// Admin → Settings: how this server is configured, read-only. It says whether each secret is set,
// never its value; changes are made in the server's environment and take effect on restart.
import useSWR from 'swr';
import { Lock } from 'lucide-react';
import { formatBytes, type AdminSettingsResponse } from '@volumes/shared';
import { formatWhen } from '@/components/preview/names';
import { Badge } from '@/components/ui/badge';
import { Page, PageHeader } from '@/components/ui/page';
import { api } from '@/lib/api/endpoints';
import { isoTitle } from '@/lib/format';
import { LoadError, Loading } from './parts';

const SIGNUP_LABEL: Record<AdminSettingsResponse['signup']['mode'], string> = {
  open: 'Open: anyone can create an account',
  'invite-only': 'Invite-only: the allowlist and admins',
  closed: 'Closed: admins only',
};

function OnOff({ on, onLabel = 'On', offLabel = 'Off' }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <Badge tone={on ? 'accent' : 'dashed'}>{on ? onLabel : offLabel}</Badge>;
}

function Row({ label, env, children }: { label: string; env?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-6 gap-y-1 border-b border-vx-hair-soft py-3 max-[720px]:grid-cols-1">
      <dt>
        <span className="block text-[14px] font-medium leading-5 text-vx-text-1">{label}</span>
        {env ? <span className="vx-micro block font-mono text-vx-text-4">{env}</span> : null}
      </dt>
      <dd className="vx-body min-w-0 break-words text-vx-text-2">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-6">
      <h2 className="vx-title">{title}</h2>
      <dl className="mt-2 border-t border-vx-hair-soft">{children}</dl>
    </section>
  );
}

export function ServerSettings() {
  const { data: s, error, mutate } = useSWR(['admin-settings'], () => api.admin.settings(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const header = (
    <PageHeader
      eyebrow="Admin"
      title="Settings"
      lead={
        <span className="inline-flex items-center gap-1.5">
          <Lock size={14} strokeWidth={1.75} aria-hidden /> Read-only. Set in the server&apos;s environment; secrets show only whether they are set.
        </span>
      }
    />
  );
  if (error && !s) return <Page>{header}<LoadError what="the settings" onRetry={() => void mutate()} /></Page>;
  if (!s) return <Page>{header}<Loading /></Page>;
  return (
    <Page>
      {header}
      <Group title="Server">
        <Row label="Public URL" env="BETTER_AUTH_URL">
          <span className="font-mono text-[13px]">{s.publicUrl}</span>
        </Row>
        <Row label="Version">
          {s.version}
          {s.commit ? <span className="ml-2 font-mono text-[13px] text-vx-text-3">{s.commit}</span> : null}
          <span className="ml-2 text-vx-text-3">· {s.nodeEnv}</span>
        </Row>
        <Row label="Running since">
          <span title={isoTitle(s.startedAt)}>{formatWhen(s.startedAt)}</span>
        </Row>
        <Row label="Storage" env="VOLUMES_STORAGE">
          {s.storage.mode === 'platinum' ? 'Platinum' : s.storage.mode === 'emulated' ? 'Emulated (local disk, for development)' : 'Not configured'}
        </Row>
        <Row label="Default quota" env="VOLUMES_DEFAULT_QUOTA_BYTES">
          {formatBytes(s.defaultQuotaBytes)} per person · up to {s.maxWorkspacesPerUser} drives each
        </Row>
        <Row label="AI agents (MCP)" env="VOLUMES_MCP_ENABLED">
          <OnOff on={s.mcpEnabled} />
        </Row>
        <Row label="Billing">
          <OnOff on={s.billing.enabled} onLabel="Stripe connected" offLabel="Off" />
        </Row>
      </Group>

      <Group title="Accounts">
        <Row label="Sign-up" env="VOLUMES_SIGNUP_MODE">
          {SIGNUP_LABEL[s.signup.mode]}
          {s.signup.mode === 'invite-only' ? (
            <span className="text-vx-text-3">
              {' '}
              · {s.signup.allowlistSize} {s.signup.allowlistSize === 1 ? 'entry' : 'entries'} on the allowlist
            </span>
          ) : null}
        </Row>
        <Row label="Email and password" env="VOLUMES_EMAIL_PASSWORD">
          <OnOff on={s.signup.emailPassword} />
        </Row>
        <Row label="Verified email required" env="VOLUMES_REQUIRE_EMAIL_VERIFICATION">
          <OnOff on={s.signup.requireEmailVerification} onLabel="Required" offLabel="Not required" />
        </Row>
        <Row label="Google sign-in" env="GOOGLE_CLIENT_ID">
          <OnOff on={s.providers.google} />
        </Row>
        <Row label="GitHub sign-in" env="GITHUB_CLIENT_ID">
          <OnOff on={s.providers.github} />
        </Row>
        <Row label="Admins from config" env="VOLUMES_ADMIN_EMAILS">
          {s.adminEmails.length ? (
            <span className="flex flex-wrap gap-1.5">
              {s.adminEmails.map((e) => (
                <Badge key={e}>{e}</Badge>
              ))}
            </span>
          ) : (
            <span className="text-vx-text-3">None. Admins come only from the Admins section.</span>
          )}
        </Row>
      </Group>

      <Group title="Email">
        <Row label="Provider" env="RESEND_API_KEY · MAILTRAP_API_TOKEN">
          {s.email.configured ? (
            <>
              <OnOff on onLabel="Configured" /> <span className="ml-1.5">{s.email.provider === 'resend' ? 'Resend' : 'Mailtrap'}</span>
            </>
          ) : (
            <>
              <OnOff on={false} offLabel="Not configured" /> <span className="ml-1.5 text-vx-text-3">no account email is delivered</span>
            </>
          )}
        </Row>
        <Row label="Sender" env="EMAIL_FROM">
          {s.email.from}
        </Row>
      </Group>
    </Page>
  );
}

export default ServerSettings;
