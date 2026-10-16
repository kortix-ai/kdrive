import { ArrowLeftRight, Copy, Link2, RotateCcw, type LucideIcon } from 'lucide-react';
import { CompareMock } from '../mocks/compare';
import { DuplicateMock } from '../mocks/duplicate';
import { RestoreMock } from '../mocks/restore';
import { ShareMock } from '../mocks/share';

// The docked proof panels, directly under the time-travel stage: four paper cards (2 × 2), each with its
// live mock, a hued icon chip, a title and one line.
const PANELS: { key: string; eyebrow: string; title: string; line: string; hue: number; Icon: LucideIcon; Mock: () => React.ReactNode }[] = [
  {
    key: 'compare',
    eyebrow: 'Compare',
    title: 'Any two versions, side by side.',
    line: 'Text diffs down to the word, a swipe for images, changed cells for spreadsheets.',
    hue: 262,
    Icon: ArrowLeftRight,
    Mock: CompareMock,
  },
  {
    key: 'restore',
    eyebrow: 'Restore',
    title: 'Bring anything back. Then undo that too.',
    line: 'Restore a file, a folder or the whole drive. The restore is a version too, so you can undo it or restore again from the timeline.',
    hue: 162,
    Icon: RotateCcw,
    Mock: RestoreMock,
  },
  {
    key: 'share',
    eyebrow: 'Share',
    title: 'Share live, or pin a version.',
    line: 'A live link always shows the latest. A pinned link shows exactly the version you picked.',
    hue: 32,
    Icon: Link2,
    Mock: ShareMock,
  },
  {
    key: 'duplicate',
    eyebrow: 'Duplicate',
    title: 'Fork a drive at any point.',
    line: 'Duplicate a drive as it is now, or as it was on Tuesday. The copy is ready at once.',
    hue: 118,
    Icon: Copy,
    Mock: DuplicateMock,
  },
];

export function Docked() {
  return (
    <div className="kd-docked" role="group" aria-label="Compare, restore, share and duplicate">
      <div className="kd-container">
        <div className="kd-docked__grid">
          {PANELS.map(({ key, eyebrow, title, line, hue, Icon, Mock }) => (
            <article key={key} className="kd-docked__panel kd-reveal" aria-labelledby={`kd-dock-${key}`} style={{ '--h': hue } as React.CSSProperties}>
              <Mock />
              <div className="kd-docked__cap">
                <span className="kd-docked__ico" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.7} />
                </span>
                <p className="kd-eyebrow kd-docked__eyebrow">{eyebrow}</p>
              </div>
              <h3 id={`kd-dock-${key}`} className="kd-h3">
                {title}
              </h3>
              <p className="kd-docked__line">{line}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
