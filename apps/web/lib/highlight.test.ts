import { describe, expect, test } from 'bun:test';
import { HIGHLIGHT_MAX_BYTES, colorToVar, highlightLines, shouldHighlight, splitLines } from './highlight';

describe('highlight', () => {
  test('colorToVar maps the palette onto --sh-* variables', () => {
    expect(colorToVar('#A78BFA')).toBe('var(--sh-str)');
    expect(colorToVar('#f4f4f7ff')).toBe('var(--sh-kw)');
    expect(colorToVar('#86868D')).toBe('var(--sh-dim)');
    expect(colorToVar('#B4530A')).toBe('var(--sh-num)');
    expect(colorToVar('#123456')).toBe('var(--sh-fg)');
    expect(colorToVar(undefined)).toBe('var(--sh-fg)');
  });

  test('shouldHighlight skips plain text and oversized input', () => {
    expect(shouldHighlight('const a = 1', 'typescript')).toBe(true);
    expect(shouldHighlight('hello', 'text')).toBe(false);
    expect(shouldHighlight('x'.repeat(HIGHLIGHT_MAX_BYTES + 1), 'typescript')).toBe(false);
    expect(shouldHighlight('\n'.repeat(7000), 'typescript')).toBe(false);
  });

  test('splitLines handles CRLF', () => {
    expect(splitLines('a\r\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  test('tokenises TypeScript into theme-variable colours, one entry per line', async () => {
    const lines = await highlightLines('const greeting = "hi";\n// done', 'typescript');
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(2);
    const text = lines!.map((l) => l.map((t) => t.content).join('')).join('\n');
    expect(text).toBe('const greeting = "hi";\n// done');
    const colours = new Set(lines!.flat().map((t) => t.color));
    for (const c of colours) expect(c.startsWith('var(--sh-')).toBe(true);
    expect(colours.has('var(--sh-str)')).toBe(true);
    // HTML is tokenised as text, never interpreted
    const html = await highlightLines('<script>alert(1)</script>', 'html');
    expect(html!.flat().map((t) => t.content).join('')).toBe('<script>alert(1)</script>');
  });

  test('unknown languages fall back to null (plain source)', async () => {
    expect(await highlightLines('x', 'not-a-language')).toBeNull();
  });
});
