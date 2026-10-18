import { GlassFolder, type GlassGlyph, type GlassPaper, type HueName } from '../glass-folder';
import { SectionHead } from './head';

// Everything else: six paper cards (3 × 2 on desktop), each with a glass folder on a dot-grid stage, a
// title and one line. The same frosted object throughout; only what peeks out of it changes.
const CELLS: { title: string; line: string; hue: HueName; paper: GlassPaper; glyph: GlassGlyph; tag: string }[] = [
  { title: 'Versions', line: 'Every change is a version, marked with who made it: you or an agent.', hue: 'cobalt', paper: 'doc', glyph: 'doc', tag: 'v31' },
  { title: 'Checkpoints', line: 'Name a moment ("before launch") and come back to it by name.', hue: 'amber', paper: 'slide', glyph: 'slides', tag: '◆ launch' },
  { title: 'Recently deleted', line: 'Deleted files and folders come back from one list, where they were.', hue: 'coral', paper: 'doc', glyph: 'pdf', tag: '7 days' },
  { title: 'Folder upload', line: 'Drop whole folders; they arrive nested exactly as they were on your disk.', hue: 'mint', paper: 'grid', glyph: 'sheet', tag: '214 files' },
  { title: 'File history', line: "Open any file's own history: every kept version, who made it and when.", hue: 'rose', paper: 'photo', glyph: 'image', tag: '9 versions' },
  { title: 'Keyboard-first', line: 'Search with / or ⌘K, jump to the timeline with h, see every shortcut with ?.', hue: 'aqua', paper: 'code', glyph: 'code', tag: '⌘K' },
];

export function Features() {
  return (
    <section id="features" className="kd-section" aria-labelledby="features-title">
      <div className="kd-container">
        <SectionHead
          id="features-title"
          eyebrow="04 · Everything else"
          hue={162}
          title="The rest of what a drive"
          em="should do."
          lead="One quiet object for everything. What peeks out of the folder tells you what is inside before you open it."
        />
        <ul className="kd-feat">
          {CELLS.map((c) => (
            <li key={c.title} className="kd-feat__cell kd-reveal">
              <div className="kd-feat__stage" aria-hidden="true">
                <div className="kd-dotgrid" />
                <GlassFolder hue={c.hue} paper={c.paper} glyph={c.glyph} tag={c.tag} size={132} />
              </div>
              <h3 className="kd-feat__title">{c.title}</h3>
              <p className="kd-feat__line">{c.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
