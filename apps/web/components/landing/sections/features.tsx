import { FeatureArt, type FeatureArtKey } from '../iso-art';
import { SectionHead } from './head';

// Everything else (LANDING-SPEC §6.5): 6 hairline cells (3×2 on desktop) after the demos, each
// with an index, a grey iso voxel illustration, a title and one line.
const CELLS: { n: string; art: FeatureArtKey; title: string; line: string }[] = [
  { n: '0.1', art: 'versions', title: 'Versions', line: 'Every change is a version, marked with who made it: you or an agent.' },
  { n: '0.2', art: 'checkpoints', title: 'Checkpoints', line: 'Name a moment ("before launch") and come back to it by name.' },
  { n: '0.3', art: 'deleted', title: 'Recently deleted', line: 'Deleted files and folders come back from one list, where they were.' },
  { n: '0.4', art: 'upload', title: 'Folder upload', line: 'Drop whole folders; they arrive nested exactly as they were on your disk.' },
  { n: '0.5', art: 'history', title: 'File history', line: "Open any file's own history: every kept version, who made it and when." },
  { n: '0.6', art: 'keyboard', title: 'Keyboard-first', line: 'Search with / or ⌘K, jump to the timeline with h, see every shortcut with ?.' },
];

export function Features() {
  return (
    <section id="features" className="kd-section" aria-labelledby="features-title">
      <div className="kd-container">
        <SectionHead id="features-title" eyebrow="04 · Everything else" title="The rest of what a drive should do." size="compact" />
        <ul className="kd-feat">
          {CELLS.map((c) => (
            <li key={c.n} className="kd-feat__cell kd-reveal">
              <span className="kd-feat__n">{c.n}</span>
              <FeatureArt name={c.art} className="kd-feat__art" />
              <h3 className="kd-feat__title">{c.title}</h3>
              <p className="kd-feat__line">{c.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
