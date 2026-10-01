import { SectionHead } from './head';

// How it works (LANDING-SPEC §6.1): one timeline strip, no illustrations and no
// cells. The line draws left to right on enter and the nodes pop in turn.
const STEPS = [
  { n: '01', title: 'Drop', line: "Drag in files or whole folders. Only blocks the drive hasn't seen are sent." },
  { n: '02', title: 'Version', line: 'Every upload, rename, move or delete is one version of the whole drive.' },
  { n: '03', title: 'Travel', line: 'Scrub the timeline and the whole drive shows itself as it was.' },
  { n: '04', title: 'Restore or share', line: 'Bring back a file, a folder or everything. Or share a live or pinned link.' },
];

export function How() {
  return (
    <section id="how" className="kd-section" aria-labelledby="how-title">
      <div className="kd-container">
        <SectionHead id="how-title" eyebrow="01 · How it works" title="Four moves. No ceremony." size="compact" />
        <div className="kd-how" data-kd-inview="">
          <span className="kd-how__line" aria-hidden="true" />
          <ol className="kd-how__steps">
            {STEPS.map((s, i) => (
              <li key={s.n} className="kd-how__step" style={{ '--kd-i': i } as React.CSSProperties}>
                <span className="kd-how__node" aria-hidden="true" />
                <span className="kd-how__n">{s.n}</span>
                <h3 className="kd-how__title">{s.title}</h3>
                <p className="kd-how__text">{s.line}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
