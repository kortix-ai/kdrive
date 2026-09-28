// Client-side code highlighting for the preview panel (lazy `import('shiki')`).
//
// Shiki runs with a Platinum palette theme whose five hex colours are then
// rewritten to the `--sh-*` CSS variables (globals.css), so highlighted code
// follows the dark / light theme (`html[data-vx-theme]`) with no re-render.
// Tokens are returned as plain data and rendered as React text nodes: no
// highlighted HTML string is ever injected into the page.

export interface HlToken {
  content: string;
  /** a `var(--sh-*)` colour */
  color: string;
  italic?: boolean;
}
export type HlLine = HlToken[];

/** The Platinum code palette (same scopes as the landing's highlighter). */
export const PLATINUM_CODE_THEME = {
  name: 'vx-platinum',
  type: 'dark' as const,
  fg: '#e8e8ec',
  bg: '#00000000',
  settings: [
    { settings: { foreground: '#e8e8ec' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#86868d', fontStyle: 'italic' } },
    { scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw'], settings: { foreground: '#a78bfa' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character'], settings: { foreground: '#a78bfa' } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control'], settings: { foreground: '#f4f4f7' } },
    { scope: ['entity.name.command', 'entity.name.tag', 'markup.heading'], settings: { foreground: '#f4f4f7' } },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.class', 'entity.name.function', 'support.function'],
      settings: { foreground: '#f4f4f7' },
    },
    { scope: ['string.unquoted.argument', 'variable.parameter', 'entity.other.attribute-name'], settings: { foreground: '#c8c8ce' } },
    { scope: ['constant.other.option', 'punctuation', 'meta.brace'], settings: { foreground: '#86868d' } },
    // after the string rules so JSON / YAML keys win over plain string colouring
    { scope: ['support.type.property-name', 'entity.name.tag.yaml'], settings: { foreground: '#c8c8ce' } },
  ],
};

const HEX_TO_VAR: Record<string, string> = {
  '#e8e8ec': 'var(--sh-fg)',
  '#f4f4f7': 'var(--sh-kw)',
  '#a78bfa': 'var(--sh-str)',
  '#c8c8ce': 'var(--sh-arg)',
  '#86868d': 'var(--sh-dim)',
};

/** Maps a Shiki hex colour (any case, optional alpha) onto the theme variable; unknown → `var(--sh-fg)`. */
export function colorToVar(color: string | undefined | null): string {
  if (!color) return 'var(--sh-fg)';
  const hex = color.trim().toLowerCase().slice(0, 7);
  return HEX_TO_VAR[hex] ?? 'var(--sh-fg)';
}

/** Past these, the preview shows plain source (still line-numbered) instead of tokenising. */
export const HIGHLIGHT_MAX_BYTES = 256 * 1024;
export const HIGHLIGHT_MAX_LINES = 6000;

export function shouldHighlight(code: string, lang: string): boolean {
  if (!lang || lang === 'text' || lang === 'plaintext') return false;
  if (code.length > HIGHLIGHT_MAX_BYTES) return false;
  let lines = 1;
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10 && ++lines > HIGHLIGHT_MAX_LINES) return false;
  return true;
}

/** Splits code into lines the same way the highlighter does (`\r\n` and `\n`). */
export function splitLines(code: string): string[] {
  return code.split(/\r?\n/);
}

type Highlighter = {
  loadLanguage: (...langs: string[]) => Promise<void>;
  getLoadedLanguages: () => string[];
  codeToTokens: (code: string, opts: { lang: string; theme: string }) => { tokens: { content: string; color?: string; fontStyle?: number }[][] };
};

let highlighter: Promise<{ h: Highlighter; bundled: Set<string> }> | null = null;

function getHighlighter() {
  highlighter ??= (async () => {
    const shiki = await import('shiki');
    const h = (await shiki.createHighlighter({
      themes: [PLATINUM_CODE_THEME],
      langs: [],
      engine: shiki.createJavaScriptRegexEngine({ forgiving: true }),
    })) as unknown as Highlighter;
    const bundled = new Set<string>([...Object.keys(shiki.bundledLanguages), ...Object.keys(shiki.bundledLanguagesAlias ?? {})]);
    return { h, bundled };
  })().catch((e) => {
    highlighter = null;
    throw e;
  });
  return highlighter;
}

/**
 * Tokenises `code` as `lang` (a shiki language id from `codeLanguage`).
 * Returns null when the language is unknown, the file is too big, or Shiki fails:
 * the caller keeps showing plain source.
 */
export async function highlightLines(code: string, lang: string): Promise<HlLine[] | null> {
  if (!shouldHighlight(code, lang)) return null;
  try {
    const { h, bundled } = await getHighlighter();
    if (!bundled.has(lang)) return null;
    if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
    const { tokens } = h.codeToTokens(code, { lang, theme: PLATINUM_CODE_THEME.name });
    return tokens.map((line) =>
      line.map((t) => ({ content: t.content, color: colorToVar(t.color), italic: t.fontStyle !== undefined && (t.fontStyle & 1) === 1 })),
    );
  } catch {
    return null;
  }
}
