'use client';

import { useState } from 'react';
import { CopyButton, Tabs } from './bits';

// The MCP client config (LANDING-SPEC §6.4): OAuth or an agent token, with
// this deployment's own MCP endpoint (from the request), or a placeholder.
type Mode = 'oauth' | 'token';
const TABS = [
  { id: 'oauth', label: 'OAuth' },
  { id: 'token', label: 'Agent token' },
] as const;

const config = (url: string): Record<Mode, string> => ({
  oauth: `{
  "mcpServers": {
    "kdrive": {
      "type": "http",
      "url": "${url}"
    }
  }
}`,
  token: `{
  "mcpServers": {
    "kdrive": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer vx_pat_…" }
    }
  }
}`,
});
const CAPTION: Record<Mode, string> = {
  oauth: 'Your client opens the browser to sign in, then asks what the agent may do.',
  token: "For scripts that can't open a browser. Tokens are shown once and expire after 30 days, 90 days or 1 year.",
};

/** Light JSON colouring: keys bright, strings mid, punctuation dim. */
function Json({ src }: { src: string }) {
  const parts = src.split(/("(?:[^"\\]|\\.)*"(?:\s*:)?)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('"') && p.trimEnd().endsWith(':')) return <span key={i} className="kd-code__k">{p}</span>;
        if (p.startsWith('"')) return <span key={i} className="kd-code__s">{p}</span>;
        return <span key={i} className="kd-code__p">{p}</span>;
      })}
    </>
  );
}

export function AgentConfigMock({ mcpUrl = 'https://<your-kdrive-host>/mcp' }: { mcpUrl?: string }) {
  const [mode, setMode] = useState<Mode>('oauth');
  const CONFIG = config(mcpUrl);
  return (
    <div className="kd-mock kd-cfg">
      <div className="kd-mock__bar">
        <Tabs label="How the agent signs in" tabs={TABS} value={mode} onChange={setMode} idBase="kd-cfg" />
        <CopyButton text={CONFIG[mode]} />
      </div>
      <div id="kd-cfg-panel" role="tabpanel" aria-labelledby={`kd-cfg-tab-${mode}`}>
        <pre className="kd-code">
          <code>
            <Json src={CONFIG[mode]} />
          </code>
        </pre>
        <p className="kd-cfg__caption">{CAPTION[mode]}</p>
      </div>
    </div>
  );
}
