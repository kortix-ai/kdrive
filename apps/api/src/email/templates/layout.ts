// The KDRIVE email frame: graphite surface, hairline borders, Inter with a
// system fallback, one light CTA. Hand-rolled table HTML with inline styles (no
// template dependency, like Platinum's mails); every caller-supplied value is
// escaped here or by the caller through esc().
//
// The lockup is the pixel K drawn as a 4×4 table of coloured cells plus the
// wordmark, never an image: mail clients block remote images by default, and
// coloured cells invert together with their text in clients that force a light theme.

export const C = {
  bg: '#0a0a0b',
  card: '#121215',
  hair: '#232329',
  text1: '#ededf0',
  text2: '#b4b4bd',
  text3: '#8b8b96',
  cta: '#ededf0',
  onCta: '#0a0a0b',
  plug: '#c8ccd4',
} as const;
const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

// The K mark as cells: B = body, P = plug, . = empty (components/brand/k-mark.tsx).
const MARK_ROWS = ['B..B', 'BPP.', 'BPP.', 'B..B'];
const MARK = `<table role="presentation" cellpadding="0" cellspacing="1" border="0">${MARK_ROWS.map(
  (row) =>
    `<tr>${[...row]
      .map((k) => {
        const c = k === 'B' ? C.text1 : k === 'P' ? C.plug : '';
        return `<td width="3" height="3" ${c ? `bgcolor="${c}" ` : ''}style="width:3px;height:3px;${c ? `background:${c};` : ''}font-size:1px;line-height:1px;">&nbsp;</td>`;
      })
      .join('')}</tr>`,
).join('')}</table>`;

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "24 hours" / "1 hour" / "30 minutes": a duration reads the same in every time zone. */
export function lifetime(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.max(1, Math.round(seconds / 60));
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  const h = Math.max(1, Math.round(seconds / 3600));
  return h === 1 ? '1 hour' : `${h} hours`;
}

export interface Frame {
  subject: string;
  /** Inbox preview line (says something the subject does not). */
  preheader: string;
  eyebrow: string;
  title: string;
  /** Paragraphs of trusted HTML (callers escape their values). */
  body: string[];
  cta?: { label: string; url: string };
  /** Footer lines of trusted HTML. */
  footer: string[];
}

const p = (html: string, color: string = C.text2, size = 14) =>
  `<p style="font-family:${SANS};font-size:${size}px;line-height:1.6;color:${color};margin:0 0 16px;">${html}</p>`;

export function renderFrame(f: Frame): string {
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(30);
  const cta = f.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td bgcolor="${C.cta}" style="background:${C.cta};border-radius:6px;"><a href="${esc(f.cta.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:14px;font-weight:600;color:${C.onCta};text-decoration:none;border-radius:6px;">${esc(f.cta.label)}</a></td>
</tr></table>
${p('Or paste this link into your browser:', C.text3, 12)}
<p style="font-family:${MONO};font-size:12px;line-height:1.6;margin:0 0 8px;word-break:break-all;"><a href="${esc(f.cta.url)}" target="_blank" style="color:${C.text2};">${esc(f.cta.url)}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>${esc(f.subject)}</title>
<style>@media only screen and (max-width:480px){.kd-shell{padding:16px 8px !important}.kd-pad{padding-left:20px !important;padding-right:20px !important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.bg};">${esc(f.preheader)}${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" class="kd-shell" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background:${C.card};border:1px solid ${C.hair};border-radius:8px;">
<tr><td class="kd-pad" style="padding:20px 28px;border-bottom:1px solid ${C.hair};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle">${MARK}</td>
<td width="10" style="width:10px;font-size:12px;line-height:12px;">&nbsp;</td>
<td valign="middle" style="font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:0.08em;line-height:12px;color:${C.text1};">KDRIVE</td>
</tr></table>
</td></tr>
<tr><td class="kd-pad" style="padding:32px 28px 12px;">
<div style="font-family:${MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${C.text3};margin:0 0 10px;">${esc(f.eyebrow)}</div>
<h1 style="font-family:${SANS};font-size:22px;line-height:1.3;font-weight:600;color:${C.text1};margin:0 0 16px;">${esc(f.title)}</h1>
${f.body.map((b) => p(b)).join('\n')}
${cta}
</td></tr>
<tr><td class="kd-pad" style="padding:20px 28px;border-top:1px solid ${C.hair};">
${f.footer.map((l) => p(l, C.text3, 12)).join('\n')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text twin: same words, links on their own lines. */
export function renderText(lines: (string | null | undefined)[]): string {
  return lines.filter((l): l is string => l !== null && l !== undefined).join('\n');
}

export const strong = (s: string) => `<span style="color:${C.text1};">${esc(s)}</span>`;
