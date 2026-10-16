import Link from 'next/link';
import { AgentConfigMock } from '../mocks/agent-config';
import { ProposalInboxMock } from '../mocks/proposal-inbox';
import { SectionHead } from './head';

// AI agents over MCP: two columns, the plumbing (the config snippet and the three access levels) on the
// left and the proof (a live proposal inbox) on the right. Agents wear cobalt, never violet.
const ACCESS = [
  { title: 'Read only', scope: 'drive:read', line: 'See files, folders, versions and history.' },
  { title: 'Suggest changes', scope: 'drive:propose', line: 'Read, and propose changes. Every change waits for your review.' },
  {
    title: 'Make changes',
    scope: 'drive:write',
    line: 'Write, move and delete, either reviewed first or applied as versions you can undo.',
  },
];

export function Agents({ mcpUrl }: { mcpUrl?: string }) {
  return (
    <section id="agents" className="kd-section" aria-labelledby="agents-title">
      <div className="kd-container">
        <SectionHead
          id="agents-title"
          eyebrow="03 · AI agents over MCP"
          hue={205}
          title="Agents propose."
          em={<>You decide, file&nbsp;by&nbsp;file.</>}
          lead="KDRIVE is an MCP server. Connect an agent with OAuth or an agent token and choose what it may do. Suggestions wait in a review inbox until you accept them."
        />
        <div className="kd-agents">
          <div className="kd-agents__left kd-reveal">
            <AgentConfigMock mcpUrl={mcpUrl} />
            <ul className="kd-access" aria-label="What an agent may do">
              {ACCESS.map((a) => (
                <li key={a.scope} className="kd-access__row">
                  <span className="kd-access__title">{a.title}</span>
                  <code className="kd-access__scope">{a.scope}</code>
                  <span className="kd-access__line">{a.line}</span>
                </li>
              ))}
            </ul>
            <Link href="/settings/agents" className="kd-arrowlink">
              Connect an agent <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="kd-agents__right kd-reveal">
            <ProposalInboxMock />
          </div>
        </div>
      </div>
    </section>
  );
}
