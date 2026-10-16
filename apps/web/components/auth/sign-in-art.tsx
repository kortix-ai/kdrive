import { FileText, Image as ImageIcon, Presentation, Sheet } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { GlassFolder, HUES } from '@/components/ui/glass-folder';

const glyph = (Icon: typeof FileText) => <Icon strokeWidth={1.7} />;

/** Four glass objects drift at the page corners, one hue each, tilted at most 3 degrees. */
const FLOATS = [
  { at: 'left-[6%] top-[16%]', tilt: -3, hue: HUES.coral, paper: 'doc', icon: FileText, tag: 'v12' },
  { at: 'right-[6%] top-[14%]', tilt: 3, hue: HUES.cobalt, paper: 'slide', icon: Presentation, tag: 'Deck' },
  { at: 'left-[8%] top-[62%]', tilt: 2, hue: HUES.mint, paper: 'grid', icon: Sheet, tag: 'Q4.csv' },
  { at: 'right-[8%] top-[64%]', tilt: -2, hue: HUES.rose, paper: 'photo', icon: ImageIcon, tag: '22 photos' },
] as const;

/** The glass objects around the auth card, wide screens only. Decorative. */
export function SignInArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] max-[1023px]:hidden">
      {FLOATS.map((f) => (
        <div key={f.tag} className={cx('absolute', f.at)}>
          <GlassFolder hue={f.hue} size={168} paper={f.paper} tag={f.tag} glyph={glyph(f.icon)} tilt={f.tilt} />
        </div>
      ))}
    </div>
  );
}

export default SignInArt;
