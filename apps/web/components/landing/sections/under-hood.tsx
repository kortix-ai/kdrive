import { BlockStripMock } from '../mocks/block-strip';

// Under the hood (LANDING-SPEC §6.6): the one place "Platinum volumes" is
// named. A benefit headline left, the lead right (top-aligned), three hairline
// columns, then the block strip at full width. The retention numbers are the
// Facts band near the top of the page.
const PILLARS = [
  { title: 'Durable', line: 'Versions and checkpoints live in the volume itself, not in a copy beside it.' },
  { title: 'Instant forks', line: 'Duplicating a drive at any point is a fork of the volume, not a copy of every byte.' },
  { title: 'Content-addressed', line: 'Files are split into 1 MiB blocks. A block the drive already holds is never sent again.' },
];

export function UnderHood() {
  return (
    <section id="under-the-hood" className="kd-section" aria-labelledby="under-the-hood-title">
      <div className="kd-container">
        <header className="kd-head kd-head--large kd-head--split kd-reveal">
          <p className="kd-eyebrow">05 · Under the hood</p>
          <h2 id="under-the-hood-title" className="kd-h2">
            History is cheap. Copies are instant.
          </h2>
          <p className="kd-lead">
            Every drive is a Platinum volume: durable, versioned storage. Versions live in the volume itself, a duplicate is a fork
            of it, and an upload sends only what is new.
          </p>
        </header>
        <ul className="kd-pillars">
          {PILLARS.map((p, i) => (
            <li key={p.title} className="kd-pillars__col kd-reveal">
              <span className="kd-pillars__n">0{i + 1}</span>
              <h3 className="kd-h3">{p.title}</h3>
              <p>{p.line}</p>
            </li>
          ))}
        </ul>
        <div className="kd-uh__strip kd-reveal">
          <BlockStripMock />
        </div>
      </div>
    </section>
  );
}
