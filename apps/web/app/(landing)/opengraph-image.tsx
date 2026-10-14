import { ImageResponse } from 'next/og';
import { DESKTOP } from '@/components/landing/hero/engine/layout';
import { posterSvg } from '@/components/landing/hero/poster-art';

// The landing's share card (LANDING-SPEC §8): the hero's own cubes (the SSR
// poster art, from the same layout), the KDRIVE wordmark and the tagline.
export const alt = 'KDRIVE · The drive that remembers.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const W = size.width;
const H = size.height;

/** Inter for the card's type; the card still renders (in the default face) if the font cannot be fetched. */
async function inter(weight: 600 | 700, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(text)}`)
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

// The pixel K (components/brand/k-mark.tsx), light on the dark card.
const MARK_SVG = (() => {
  const cell = (x: number, y: number, fill: string) =>
    `<rect x="${x * 10 + 0.6}" y="${y * 10 + 0.6}" width="8.8" height="8.8" rx="2.4" fill="${fill}"/>`;
  const body = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [3, 3]].map(([x, y]) => cell(x, y, '#ededf0')).join('');
  const plug = [[1, 1], [1, 2], [2, 1], [2, 2]].map(([x, y]) => cell(x, y, '#ededf0')).join('');
  const contacts = '<rect x="23.8" y="13.8" width="2.4" height="2.4" rx=".6" fill="#0a0a0b"/><rect x="23.8" y="23.8" width="2.4" height="2.4" rx=".6" fill="#0a0a0b"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${body}${plug}${contacts}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
})();

export default async function OpengraphImage() {
  const art = `data:image/svg+xml;base64,${Buffer.from(posterSvg(DESKTOP, W, H)).toString('base64')}`;
  const [bold, semi] = await Promise.all([inter(700, 'KDRIVE'), inter(600, 'The drive that remembers.')]);
  const fonts = [
    ...(bold ? [{ name: 'Inter', data: bold, weight: 700 as const, style: 'normal' as const }] : []),
    ...(semi ? [{ name: 'Inter', data: semi, weight: 600 as const, style: 'normal' as const }] : []),
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
          background: '#0a0a0b',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            // the hero's violet atmosphere (a deep glow under the name)
            backgroundImage: 'radial-gradient(circle at 50% 78%, rgba(60,44,120,0.55) 0%, rgba(42,31,77,0.25) 35%, rgba(10,10,11,0) 70%)',
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art} width={W} height={H} alt="" style={{ position: 'absolute', inset: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_SVG} width={96} height={96} alt="" style={{ marginBottom: 28 }} />
          <div
            style={{
              fontSize: 168,
              fontWeight: 700,
              letterSpacing: -6,
              lineHeight: 1,
              color: 'transparent',
              backgroundImage: 'linear-gradient(180deg, #f6f7f9 0%, #e3e6eb 38%, #c8ccd4 52%, #eef0f3 70%, #8d929c 100%)',
              backgroundClip: 'text',
            }}
          >
            KDRIVE
          </div>
          <div style={{ marginTop: 18, fontSize: 46, fontWeight: 600, letterSpacing: -1.4, color: '#dcdde2' }}>
            The drive that remembers.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
