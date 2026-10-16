import { BlockStripMock } from '../mocks/block-strip';
import { SectionHead } from './head';

// Under the hood: the one place "Platinum volumes" is named. A benefit headline left, the lead right, three
// paper cards, then the block strip on a stone mat. The retention numbers are the Facts band near the top.
const PILLARS = [
  { title: 'Durable', line: 'Versions and checkpoints live in the volume itself, not in a copy beside it.' },
  { title: 'Instant forks', line: 'Duplicating a drive at any point is a fork of the volume, not a copy of every byte.' },
  { title: 'Content-addressed', line: 'Files are split into 1 MiB blocks. A block the drive already holds is never sent again.' },
];

export function UnderHood() {
  return (
    <section id="under-the-hood" className="kd-section" aria-labelledby="under-the-hood-title">
      <div className="kd-container">
        <SectionHead
          id="under-the-hood-title"
          eyebrow="05 · Under the hood"
          hue={352}
          title="History is cheap."
          em="Copies are instant."
          lead="Every drive is a Platinum volume: durable, versioned storage. Versions live in the volume itself, a duplicate is a fork of it, and an upload sends only what is new."
        />
        <ul className="kd-pillars">
          {PILLARS.map((p, i) => (
            <li key={p.title} className="kd-pillars__col kd-reveal">
              <span className="kd-pillars__n">0{i + 1}</span>
              <h3 className="kd-h3">{p.title}</h3>
              <p>{p.line}</p>
            </li>
          ))}
        </ul>
        <div className="kd-mat kd-uh__strip kd-reveal">
          <div className="kd-dotgrid" aria-hidden="true" />
          <BlockStripMock />
        </div>
      </div>
    </section>
  );
}
