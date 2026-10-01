'use client';

// Settings → AI agents, card 1: the MCP server URL and ready-to-paste setup snippets.
import { useState } from 'react';
import { Section } from '@/components/settings/section';
import { CopyButton } from '@/components/share/copy-button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { useConfig } from '@/lib/api/hooks';

/** Placeholder the token snippet shows until a real token is filled in. */
export const TOKEN_PLACEHOLDER = '<your token>';

/** A generic MCP client configuration: HTTP transport, and a bearer header when a token is given. */
export function mcpConfigSnippet(url: string, token?: string): string {
  const server: Record<string, unknown> = { type: 'http', url };
  if (token !== undefined) server.headers = { Authorization: `Bearer ${token}` };
  return JSON.stringify({ mcpServers: { volumes: server } }, null, 2);
}

/** A one-line "add this server" example; `your-agent` stands for the client's own command. */
export function cliSnippet(url: string): string {
  return `your-agent mcp add --transport http volumes ${url}`;
}

/**
 * A mono block on surface-2 (r12): a head row with its label and Copy, then the code,
 * wrapped so every character stays readable (a long URL is never hidden under the button
 * or behind a sideways scroll).
 */
export function Snippet({ text, label, onCopied }: { text: string; label: string; onCopied?: () => void }) {
  return (
    <div className="min-w-0 rounded-vx-md bg-vx-surface-2">
      <div className="flex items-center justify-between gap-3 border-b border-vx-hair-soft py-1.5 pl-4 pr-2">
        <span className="vx-micro truncate text-vx-text-3">{label}</span>
        <CopyButton text={text} size="xs" variant="text" onCopied={onCopied} />
      </div>
      <pre aria-label={label} className="vx-code whitespace-pre-wrap break-all px-4 py-3 !text-[13px] !leading-5 text-vx-text-1">
        {text}
      </pre>
    </div>
  );
}

type Method = 'signin' | 'token';

/** Connect an agent: the URL with Copy, then the snippets for Sign in (recommended) or an agent token. */
export function ConnectSection() {
  const { data: config, error } = useConfig();
  const [method, setMethod] = useState<Method>('signin');
  const description = 'Add Volumes as an MCP server in your AI agent. It signs in with your account and asks you what it may do.';

  if (!config) {
    return (
      <Section id="agents-connect" label="Connect an agent" description={description}>
        {error ? (
          <p className="vx-body text-vx-text-3">Can&apos;t load the server settings right now.</p>
        ) : (
          <span className="skeleton block h-11 w-full" />
        )}
      </Section>
    );
  }
  if (!config.mcp.enabled) {
    return (
      <Section id="agents-connect" label="Connect an agent">
        <p className="vx-body text-vx-text-3">AI agent access is turned off on this server.</p>
      </Section>
    );
  }
  const url = config.mcp.url;
  return (
    <Section id="agents-connect" label="Connect an agent" description={description}>
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <Input label="MCP server URL" readOnly mono value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1" />
          <CopyButton text={url} className="mb-1.5" />
        </div>
        <Segmented<Method>
          label="How the agent signs in"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'signin', label: 'Sign in (recommended)' },
            { value: 'token', label: 'Agent token' },
          ]}
          className="self-start"
        />
        {method === 'signin' ? (
          <div className="flex flex-col gap-3">
            <Snippet label="MCP client configuration" text={mcpConfigSnippet(url)} />
            <Snippet label="Command line example" text={cliSnippet(url)} />
            <p className="vx-micro text-vx-text-3">Replace your-agent with your client&apos;s command.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Snippet label="MCP client configuration with a token" text={mcpConfigSnippet(url, TOKEN_PLACEHOLDER)} />
            <p className="vx-micro text-vx-text-3">Create a token below.</p>
          </div>
        )}
      </div>
    </Section>
  );
}

export default ConnectSection;
