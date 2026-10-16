import { GlassFolder, type HueName } from '../glass-folder';
import { SectionHead } from './head';

// How it works: four moves in four columns split by hairlines, each with a small glass folder whose tag
// tells the step's state. Two columns on tablets, one on small phones.
const STEPS: { n: string; title: string; line: string; hue: HueName; tag: string }[] = [
  { n: '01', title: 'Drop', line: "Drag in files or whole folders. Only blocks the drive hasn't seen are sent.", hue: 'coral', tag: '+3' },
  { n: '02', title: 'Version', line: 'Every upload, rename, move or delete is one version of the whole drive.', hue: 'amber', tag: 'v31' },
  { n: '03', title: 'Travel', line: 'Scrub the timeline and the whole drive shows itself as it was.', hue: 'cobalt', tag: 'v18' },
  { n: '04', title: 'Restore or share', line: 'Bring back a file, a folder or everything. Or share a live or pinned link.', hue: 'mint', tag: 'live' },
];

export function How() {
  return (
    <section id="how" className="kd-section kd-section--first" aria-labelledby="how-title">
      <div className="kd-container">
        <SectionHead
          id="how-title"
          eyebrow="01 · How it works"
          hue={32}
          title="Four moves."
          em="No ceremony."
          lead="Nothing to configure. Versioning is on from the first file you drop in, and it covers the whole drive, not just single documents."
        />
        <ol className="kd-how">
          {STEPS.map((s) => (
            <li key={s.n} className="kd-how__step kd-reveal">
              <span className="kd-how__n">{s.n}</span>
              <GlassFolder hue={s.hue} paper="two" tag={s.tag} size={112} className="kd-how__obj" />
              <h3 className="kd-how__title">{s.title}</h3>
              <p className="kd-how__text">{s.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
