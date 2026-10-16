import { ImageResponse } from 'next/og';

// The landing's share card: the hero in miniature. Oat paper with the dot grid, the pixel K and the KDRIVE
// wordmark in ink, the tagline with its serif word, and six glass folders (three above, three below) in the
// object hues. The image renderer has no CSS variables or oklch, so the light theme's token values
// (app/globals.css) are written out here.
export const alt = 'KDRIVE · The drive that remembers.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const W = size.width;
const H = size.height;

// --vx-bg, --vx-text-1, --vx-text-2, --vx-dot, --vx-paper (light)
const BG = '#ECE8E0';
const INK = '#1B1A17';
const INK_2 = '#45423C';
const DOT = 'rgba(28,26,23,0.10)';
const PAPER = '#FFFEFB';

// the folders' back and glass per hue, oklch(.72 .10 h) / oklch(.84 .085 h) in sRGB
const FOLDERS = [
  { back: '#D9826F', glass: 'rgba(244,178,163,0.82)', x: 150, y: 46, r: -3 },
  { back: '#7E9BE0', glass: 'rgba(170,192,248,0.82)', x: 520, y: 26, r: 2 },
  { back: '#5DB088', glass: 'rgba(150,214,178,0.82)', x: 890, y: 52, r: -2 },
  { back: '#C79A52', glass: 'rgba(236,198,140,0.82)', x: 150, y: 470, r: 2 },
  { back: '#46AAB4', glass: 'rgba(140,212,220,0.82)', x: 520, y: 494, r: -2 },
  { back: '#D17A9E', glass: 'rgba(244,176,204,0.82)', x: 890, y: 474, r: 3 },
];
const FW = 160;
const FH = Math.round(FW * 0.72);

/** A Google font subset for the card's type; the card still renders (in the default face) if it cannot be fetched. */
async function font(family: string, axis: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=${family}:${axis}&text=${encodeURIComponent(text)}`)
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

// The pixel K (components/brand/k-mark.tsx), ink on paper.
const MARK_SVG = (() => {
  const cell = (x: number, y: number) => `<rect x="${x * 10 + 0.6}" y="${y * 10 + 0.6}" width="8.8" height="8.8" rx="2.4" fill="${INK}"/>`;
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [3, 3], [1, 1], [1, 2], [2, 1], [2, 2]].map(([x, y]) => cell(x, y)).join('');
  const contacts = `<rect x="23.8" y="13.8" width="2.4" height="2.4" rx=".6" fill="${BG}"/><rect x="23.8" y="23.8" width="2.4" height="2.4" rx=".6" fill="${BG}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${cells}${contacts}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
})();

function Folder({ back, glass, x, y, r }: (typeof FOLDERS)[number]) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: FW, height: FH, display: 'flex', transform: `rotate(${r}deg)` }}>
      {/* tab + back */}
      <div style={{ position: 'absolute', left: 5, top: 4, width: 64, height: 22, borderRadius: '8px 8px 0 0', background: back, border: `1.5px solid ${INK}` }} />
      <div style={{ position: 'absolute', left: 5, right: 5, top: 18, bottom: 8, borderRadius: '0 10px 10px 10px', background: back, border: `1.5px solid ${INK}` }} />
      {/* a paper peeking out */}
      <div style={{ position: 'absolute', left: 22, top: 10, width: 70, height: 72, borderRadius: 5, background: PAPER, transform: 'rotate(-6deg)', boxShadow: '0 4px 10px rgba(0,0,0,0.15)' }} />
      {/* the glass front */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: Math.round(FH * 0.38),
          bottom: 0,
          borderRadius: 10,
          background: `linear-gradient(172deg, rgba(255,255,255,0.55), ${glass})`,
          border: '1px solid rgba(255,255,255,0.7)',
          boxShadow: '0 8px 16px -8px rgba(40,30,20,0.35)',
        }}
      />
    </div>
  );
}

export default async function OpengraphImage() {
  const [sans, serif] = await Promise.all([
    font('Geist', 'wght@600', 'KDRIVEThe drive that'),
    font('Instrument+Serif', 'ital@1', 'remembers.'),
  ]);
  const fonts = [
    ...(sans ? [{ name: 'Geist', data: sans, weight: 600 as const, style: 'normal' as const }] : []),
    ...(serif ? [{ name: 'Instrument Serif', data: serif, weight: 400 as const, style: 'italic' as const }] : []),
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG,
          backgroundImage: `radial-gradient(circle at 1.5px 1.5px, ${DOT} 1.5px, transparent 2px)`,
          backgroundSize: '24px 24px',
          fontFamily: 'Geist',
        }}
      >
        {FOLDERS.map((f) => (
          <Folder key={`${f.x}-${f.y}`} {...f} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK_SVG} width={104} height={104} alt="" style={{ marginRight: 26 }} />
            <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: 4, lineHeight: 1, color: INK }}>KDRIVE</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 22, fontSize: 46, fontWeight: 600, letterSpacing: -1, color: INK }}>
            <span>The drive that</span>
            <span style={{ marginLeft: 12, fontFamily: 'Instrument Serif', fontStyle: 'italic', fontWeight: 400, fontSize: 54, color: INK_2 }}>
              remembers.
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
