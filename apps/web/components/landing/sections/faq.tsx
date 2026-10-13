import { SectionHead } from './head';

// FAQ (LANDING-SPEC §6.7): native <details>, works without JS; the first item
// is open. The head is sticky on desktop.
const QA = [
  {
    q: 'What counts as a version?',
    a: 'Any change to the drive: an upload, a rename, a move, a delete, a restore. One action is one version of the whole drive, so dropping 200 files at once is one version. Each version records who made it: you, or an agent you connected.',
  },
  { q: 'How long is history kept?', a: 'Every version from the last 7 days, your newest 50 always, and checkpoints until you remove them.' },
  {
    q: 'Can I undo a restore?',
    a: "Yes. A restore is a version like any other, so you can undo it. If later changes touched the same files, KDRIVE won't overwrite them; restore from the timeline instead.",
  },
  {
    q: 'What happens when I delete something?',
    a: 'It goes to Recently deleted for 7 days, where you can restore it. Its earlier versions stay in the timeline for as long as retention keeps them.',
  },
  {
    q: "What's the difference between a live and a pinned link?",
    a: 'A live link shows the latest. A pinned link shows one version and never changes. Links can expire after 1 day, 7 days, 30 days or a date you pick, or never.',
  },
  {
    q: 'How do AI agents connect?',
    a: 'KDRIVE is an MCP server. Add its URL to any client that speaks MCP over HTTP and sign in with OAuth, or create an agent token for scripts; a token lasts 30, 90 or 365 days and you can revoke it at any time. You choose read only, suggest changes or make changes, and whether changes wait for your review.',
  },
  {
    q: 'Can an agent mess up my drive?',
    a: "An agent that suggests changes can't change anything until you accept. An agent that makes changes directly writes versions marked with its name, and you can undo them or restore an earlier version. You can lower its access or disconnect it at any time.",
  },
  {
    q: 'How much space do I get?',
    a: "10 GB to start, and 100 GB with Plus or 1 TB with Pro (see Pricing). It counts what your drives hold now: past versions and checkpoints don't use it. A duplicate counts as a drive of its own.",
  },
  {
    q: 'What are Platinum volumes?',
    a: 'The durable, versioned storage KDRIVE is built on. Each drive is one volume; versions, checkpoints and duplicates are features of the volume itself.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="kd-section kd-faq-section" aria-labelledby="faq-title">
      <div className="kd-container kd-faq">
        <div className="kd-faq__head">
          <SectionHead id="faq-title" eyebrow="06 · FAQ" title="Questions, answered plainly." size="compact" />
        </div>
        <div className="kd-faq__list">
          {QA.map((item, i) => (
            <details key={item.q} className="kd-faq__item" open={i === 0}>
              <summary>
                <span>{item.q}</span>
                <span className="kd-faq__icon" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
