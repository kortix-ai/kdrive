// `bun run seed`: fills the dev account's drive with a realistic demo — folders,
// Markdown, code, CSV, JSON, a PDF, a WAV clip and PNG images generated here,
// several edits (so files have versions), a rename, a checkpoint "First draft",
// a deleted file, and a live + a pinned share link.
//
// It drives the real HTTP API (dev sign-in, block uploads, file operations),
// so the ledger and timeline look exactly like a person made the changes.
// When the API is already running on API_PORT it talks to that server
// (the emulator keeps state in memory, so a second process must not write to
// its data dir); otherwise it runs the app in-process.
//
// Usage: bun run seed [--email you@example.com] [--force]
//   --force  seed even when the drive is not empty (clears the root first).
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { BLOCK_SIZE } from '@volumes/shared';

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const EMAIL = (argValue('--email') ?? process.env.SEED_EMAIL ?? 'dev@volumes.local').toLowerCase();
const FORCE = args.includes('--force');
const ORIGIN = process.env.BETTER_AUTH_URL ?? 'http://localhost:4100';
const API_PORT = Number(process.env.API_PORT ?? 4101);
const API = `http://127.0.0.1:${API_PORT}`;

if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo refuses to run with NODE_ENV=production.');
  process.exit(1);
}

// ── transport: the running API, or the app in-process ──────────────────────

type Fetch = (req: Request) => Promise<Response>;

async function transport(): Promise<{ fetch: Fetch; mode: string }> {
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { fetch: (req) => fetch(req), mode: `running API at ${API}` };
  } catch {
    /* not running */
  }
  const { createApp } = await import('../src/app');
  const app = createApp();
  return { fetch: (req) => Promise.resolve(app.fetch(req)), mode: 'in-process app' };
}

const cookies = new Map<string, string>();
let send: Fetch;

async function call(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': '127.0.0.1' });
  if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  let payload: BodyInit | null = null;
  if (raw) {
    headers.set('content-type', 'application/octet-stream');
    payload = raw as unknown as BodyInit;
  } else if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await send(new Request(`${API}${path}`, { method, headers, body: payload }));
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(sc) || !value) cookies.delete(name);
      else cookies.set(name, value);
    }
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await Bun.sleep(Math.min(30, Math.max(1, wait)) * 1000);
      continue;
    }
    return res;
  }
}

async function json<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, body ?? (method === 'GET' || method === 'DELETE' ? undefined : {}));
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

// ── generated content ──────────────────────────────────────────────────────

const enc = (s: string) => new TextEncoder().encode(s);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGB PNG from a pixel function (deflate via node:zlib). */
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(enc(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: number[], b: number[], t: number): [number, number, number] => [
  clamp(a[0] + (b[0] - a[0]) * t),
  clamp(a[1] + (b[1] - a[1]) * t),
  clamp(a[2] + (b[2] - a[2]) * t),
];

const sunset = (variant: number) =>
  png(960, 600, (x, y) => {
    const sky = mix([36, 26, 72], [250, 150, 90 + variant * 20], y / 380);
    const sunD = Math.hypot(x - 620, y - 330);
    if (y > 400) {
      const wave = Math.sin(x / 18 + y / 3) * 10;
      return mix([30, 40, 80], [240, 140, 90], Math.max(0, 1 - Math.abs(x - 620) / 260) * (1 - (y - 400) / 260) + wave / 255);
    }
    if (sunD < 70) return [255, 214, 140];
    const glow = Math.max(0, 1 - sunD / 260);
    return mix(sky, [255, 200, 130], glow * 0.6);
  });

const tram = png(720, 480, (x, y) => {
  const street = y > 360;
  if (street) return (Math.floor(x / 40) + Math.floor(y / 20)) % 2 ? [120, 116, 108] : [104, 100, 94];
  const inBody = x > 170 && x < 560 && y > 170 && y < 350;
  if (inBody) {
    const win = y > 200 && y < 270 && (x - 190) % 70 < 50;
    return win ? [150, 200, 230] : [238, 196, 40];
  }
  if (y > 350 && y < 362 && (Math.abs(x - 230) < 22 || Math.abs(x - 500) < 22)) return [40, 40, 40];
  return mix([230, 230, 240], [200, 180, 160], y / 360);
});

const tiles = png(512, 512, (x, y) => {
  const cx = (x % 128) - 64;
  const cy = (y % 128) - 64;
  const r = Math.hypot(cx, cy);
  const petal = Math.abs(Math.sin(Math.atan2(cy, cx) * 4)) * 40 + 12;
  if (r < petal) return [28, 70, 160];
  if (Math.abs(cx) < 3 || Math.abs(cy) < 3) return [40, 90, 180];
  return (Math.floor(x / 128) + Math.floor(y / 128)) % 2 ? [246, 244, 236] : [236, 240, 250];
});

const avatar = png(256, 256, (x, y) => {
  const d = Math.hypot(x - 128, y - 128);
  if (d > 120) return [24, 24, 28];
  return mix([167, 139, 250], [90, 60, 180], d / 120);
});

/** A small valid PDF with one page of text (offsets computed, not guessed). */
function pdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = [
    'BT',
    '/F1 22 Tf 72 740 Td',
    `(${esc(title)}) Tj`,
    '/F1 12 Tf',
    ...lines.flatMap((l) => ['0 -24 Td', `(${esc(l)}) Tj`]),
    'ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

/** 8-bit mono WAV: a short three-note chime. */
function wav(seconds = 1.8, rate = 22050): Uint8Array {
  const n = Math.floor(seconds * rate);
  const out = new Uint8Array(44 + n);
  const dv = new DataView(out.buffer);
  out.set(enc('RIFF'), 0);
  dv.setUint32(4, 36 + n, true);
  out.set(enc('WAVEfmt '), 8);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  out.set(enc('data'), 36);
  dv.setUint32(40, n, true);
  const notes = [523.25, 659.25, 783.99];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = Math.min(2, Math.floor(t / (seconds / 3)));
    const local = t - (k * seconds) / 3;
    const env = Math.exp(-local * 4);
    out[44 + i] = clamp(128 + 90 * env * Math.sin(2 * Math.PI * notes[k] * t));
  }
  return out;
}

const planV1 = `# Volumes launch plan

## Goal
Ship a personal drive where every change is a version.

## Milestones
- [x] Storage on Platinum volumes
- [ ] Timeline and time travel
- [ ] Share links

## Owners
| Area | Owner |
|---|---|
| API | Sam |
| Web | Priya |
`;

const planV2 = planV1
  .replace('- [ ] Timeline and time travel', '- [x] Timeline and time travel')
  .replace('## Owners', '## Risks\n- Upload limits on large folders\n- Retention copy must match storage rules\n\n## Owners');

const planV3 = planV2
  .replace('- [ ] Share links', '- [x] Share links\n- [ ] Public beta')
  .replace('| Web | Priya |', '| Web | Priya |\n| Design | Lee |');

const budgetV1 = `category,q1,q2,q3,q4
Storage,1200,1400,1650,1900
Compute,800,820,900,950
Design,400,400,300,300
Support,150,200,260,320
`;

const budgetV2 = `category,q1,q2,q3,q4
Storage,1200,1450,1700,2050
Compute,800,820,900,950
Design,400,400,350,300
Support,150,200,260,320
Marketing,0,300,500,800
`;

const websiteIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Volumes</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Every change is a version.</h1>
      <p>Browse, compare, restore or share any point in time.</p>
      <script type="module" src="app.js"></script>
    </main>
  </body>
</html>
`;

const websiteCss = `:root {
  --bg: #0b0b0e;
  --fg: #ececf1;
  --accent: #a78bfa;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 Inter, system-ui, sans-serif;
}

h1 {
  font-size: 3rem;
  letter-spacing: -0.02em;
}
`;

const websiteApp = `type Version = { id: string; createdAt: string; summary: string };

export async function loadTimeline(ws: string): Promise<Version[]> {
  const res = await fetch(\`/api/w/\${ws}/timeline?limit=20\`);
  if (!res.ok) throw new Error(\`timeline failed: \${res.status}\`);
  const body = (await res.json()) as { entries: Version[] };
  return body.entries;
}

export function describe(v: Version): string {
  const when = new Date(v.createdAt).toLocaleString();
  return \`\${when} — \${v.summary}\`;
}
`;

const websiteAppV2 = websiteApp.replace(
  'export function describe',
  `/** Newest first; never shows more than \`max\`. */
export function latest(versions: Version[], max = 5): Version[] {
  return [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max);
}

export function describe`,
);

const readme = `# Website

Static landing page for Volumes.

\`\`\`sh
bun x serve .
\`\`\`

- \`index.html\` — markup
- \`styles.css\` — tokens and type
- \`app.ts\` — reads the timeline
`;

const meetingNotes = `# Weekly sync — 21 Sep

**Present:** Sam, Priya, Lee

1. Uploads: folder uploads keep empty folders now.
2. Timeline: one entry per action, even for 12,000-file uploads.
3. Next: checkpoints UI, recently deleted.

> Decision: pinned share links always tag their version.
`;

const ideas = `Ideas
=====

* Drag a timeline entry onto a folder to restore just that folder
* Weekly digest of what changed
* "Compare with checkpoint" shortcut
`;

const settingsJson = JSON.stringify(
  {
    theme: 'dark',
    retention: { days: 7, newest: 50, checkpoints: 'forever' },
    shortcuts: { search: '/', upload: 'u', newFolder: 'n', timeline: 'h' },
  },
  null,
  2,
);

const oldDraft = `# Old draft

This outline was replaced by plan.md.
`;

const contacts = `name,email,team
Sam Rivera,sam@example.com,API
Priya Nair,priya@example.com,Web
Lee Park,lee@example.com,Design
`;

// ── upload helper (plan → missing blocks → commit) ─────────────────────────

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function upload(ws: string, files: Record<string, string | Uint8Array>, dirs: string[] = []): Promise<string> {
  const list = Object.entries(files).map(([path, v]) => {
    const bytes = typeof v === 'string' ? enc(v) : v;
    const blocks: { sha: string; bytes: Uint8Array }[] = [];
    for (let off = 0; off < bytes.length; off += BLOCK_SIZE) {
      const chunk = bytes.subarray(off, Math.min(off + BLOCK_SIZE, bytes.length));
      blocks.push({ sha: sha(chunk), bytes: chunk });
    }
    return { path, bytes, blocks };
  });
  const plan = await json('POST', `/api/w/${ws}/uploads`, {
    files: list.map((f) => ({ path: f.path, size: f.bytes.length, blocks: f.blocks.map((b) => b.sha) })),
    dirs,
    conflict: 'replace',
  });
  const missing = new Set<string>(plan.missing);
  for (const f of list) {
    for (const b of f.blocks) {
      if (!missing.delete(b.sha)) continue;
      const r = await call('PUT', `/api/w/${ws}/uploads/${plan.uploadId}/blocks/${b.sha}`, undefined, b.bytes.slice());
      if (r.status !== 204) throw new Error(`block upload failed: ${r.status} ${await r.text()}`);
    }
  }
  const done = await json('POST', `/api/w/${ws}/uploads/${plan.uploadId}/commit`, {});
  return done.action.summary as string;
}

// ── seed ───────────────────────────────────────────────────────────────────

async function main() {
  const t = await transport();
  send = t.fetch;
  console.log(`Seeding ${EMAIL} via the ${t.mode}…`);

  await json('POST', '/api/auth/dev/sign-in', { email: EMAIL, name: EMAIL === 'dev@volumes.local' ? 'Dev' : undefined });
  const me = await json('GET', '/api/me');
  const ws = me.defaultWorkspaceId as string;
  const root = await json('GET', `/api/w/${ws}/files?path=/`);
  if (root.entries.length) {
    if (!FORCE) {
      console.log(`The drive already has ${root.entries.length} item(s); nothing seeded. Pass --force to clear the root and seed again.`);
      return;
    }
    await json('POST', `/api/w/${ws}/files/delete`, { paths: root.entries.map((e: { path: string }) => e.path) });
    console.log('  cleared the root (the old files stay in history)');
  }

  const step = (s: string) => console.log(`  ${s}`);
  const P = '/Projects/Volumes launch';
  const W = '/Projects/Website';
  const L = '/Photos/2026 Lisbon';

  step(
    await upload(
      ws,
      {
        [`${P}/plan.md`]: planV1,
        [`${P}/budget.csv`]: budgetV1,
        [`${P}/notes.txt`]: ideas,
        [`${W}/index.html`]: websiteIndex,
        [`${W}/styles.css`]: websiteCss,
        [`${W}/app.ts`]: websiteApp,
        [`${W}/README.md`]: readme,
      },
      [`${W}/assets`],
    ),
  );
  step(
    await upload(
      ws,
      { [`${L}/sunset.png`]: sunset(0), [`${L}/tram.png`]: tram, [`${L}/tiles.png`]: tiles },
      ['/Photos/Unsorted'],
    ),
  );
  step(
    await upload(ws, {
      '/Documents/Quarterly report.pdf': pdf('Volumes - Q3 report', [
        'Storage used grew 38% quarter on quarter.',
        'Restores: 1,204 files, 96 folders, 3 whole drives.',
        'Median time to open a past version: 240 ms.',
      ]),
      '/Documents/Meeting notes.md': meetingNotes,
      '/Documents/settings.json': settingsJson,
      '/Documents/contacts.csv': contacts,
      '/Documents/old-draft.md': oldDraft,
      '/Documents/chime.wav': wav(),
      '/avatar.png': avatar,
    }),
  );
  step((await json('POST', `/api/w/${ws}/folders`, { path: '/Archive' })).action.summary);

  const cp = await json('POST', `/api/w/${ws}/checkpoints`, { name: 'First draft', note: 'Everything in place before the first round of edits.' });
  step(`Checkpoint "${cp.checkpoint.name}"`);

  step(await upload(ws, { [`${P}/plan.md`]: planV2 }));
  step(await upload(ws, { [`${P}/budget.csv`]: budgetV2 }));
  step(await upload(ws, { [`${W}/app.ts`]: websiteAppV2 }));
  step((await json('POST', `/api/w/${ws}/files/move`, { items: [{ from: `${P}/notes.txt`, to: `${P}/ideas.txt` }] })).action.summary);
  step(await upload(ws, { [`${L}/sunset.png`]: sunset(1) }));
  step((await json('POST', `/api/w/${ws}/files/delete`, { paths: ['/Documents/old-draft.md'] })).action.summary);
  const beforeV3 = (await json('GET', `/api/w/${ws}/commits/head`)).id as string;
  step(await upload(ws, { [`${P}/plan.md`]: planV3 }));

  const live = await json('POST', `/api/w/${ws}/links`, { path: L, mode: 'live' });
  const pinned = await json('POST', `/api/w/${ws}/links`, { path: `${P}/plan.md`, mode: 'pinned', at: beforeV3 });
  step(`Live link to ${L}: ${live.link.url}`);
  step(`Pinned link to plan.md (before the last edit): ${pinned.link.url}`);

  const usage = await json('GET', '/api/me/usage');
  console.log(`Done. ${(usage.usedBytes / 1024).toFixed(0)} KiB used. Sign in at ${ORIGIN}/signin as ${EMAIL}.`);
}

await main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
// postgres-js keeps the pool open in the in-process mode.
process.exit(process.exitCode ?? 0);
