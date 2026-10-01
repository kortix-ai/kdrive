// Bounded JSON pretty-printing, shared by the preview and the compare view.
// Pure functions (no React), so they run in `bun test`.

/**
 * Pretty-printing adds a newline and indentation per value, so deep nesting grows
 * quadratically (a 6 KB file of brackets would print as 18 MB), and numbers print in
 * full (`1e20` becomes 21 digits). Past ten times the file (at least 1 MiB, at most this)
 * the JSON is shown as it is stored.
 */
export const PRETTY_JSON_MAX_CHARS = 32 * 1024 * 1024;

/** The most characters `prettyJsonResult` prints for a file of `inputLength` characters. */
export const prettyBudget = (inputLength: number) => Math.min(PRETTY_JSON_MAX_CHARS, Math.max(1024 * 1024, inputLength * 10));

const isNumberChar = (c: number) => (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46 || c === 69 || c === 101; // 0-9 + - . E e

/**
 * An upper bound on the length of `JSON.stringify(JSON.parse(text), null, 2)`, in one pass
 * over the text: every value gets a newline and its indentation (empty containers are
 * over-counted), and every number counts at the length it prints (`1e20` → 21, `1e400` →
 * `null`). Stops early once past `cap`.
 */
export function prettyJsonSizeBound(text: string, cap = Infinity): number {
  let size = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      size++;
      if (c === 92 /* \\ */) {
        i++;
        size++;
      } else if (c === 34 /* " */) inString = false;
      continue;
    }
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    if (c === 45 || (c >= 48 && c <= 57)) {
      // a number: count what it prints as, not what is stored
      let j = i + 1;
      while (j < text.length && isNumberChar(text.charCodeAt(j))) j++;
      const printed = JSON.stringify(Number(text.slice(i, j)));
      size += Math.max(printed.length, j - i);
      i = j - 1;
      if (size > cap) return size;
      continue;
    }
    size++;
    if (c === 34) inString = true;
    else if (c === 91 || c === 123 /* [ { */) size += 1 + 2 * ++depth;
    else if (c === 93 || c === 125 /* ] } */) size += 1 + 2 * (depth = Math.max(0, depth - 1));
    else if (c === 44 /* , */) size += 1 + 2 * depth;
    else if (c === 58 /* : */) size += 1;
    if (size > cap) return size;
  }
  return size;
}

export type PrettyJson = { status: 'pretty' | 'invalid' | 'too-large'; text: string };

/**
 * JSON pretty-printed (2 spaces), or the text as stored when it is not JSON or would print
 * past `prettyBudget(text.length)`. The printed result is never longer than that budget.
 */
export function prettyJsonResult(text: string): PrettyJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: 'invalid', text };
  }
  const budget = prettyBudget(text.length);
  if (prettyJsonSizeBound(text, budget) > budget) return { status: 'too-large', text };
  let out: string;
  try {
    out = JSON.stringify(value, null, 2);
  } catch {
    return { status: 'too-large', text };
  }
  // The estimate is an upper bound; this keeps the promise even if it were ever wrong.
  if (out.length > budget) return { status: 'too-large', text };
  return { status: 'pretty', text: out };
}

/** Pretty-prints JSON; returns null when `text` is not valid JSON (or would print too large). */
export function prettyJson(text: string): string | null {
  const r = prettyJsonResult(text);
  return r.status === 'pretty' ? r.text : null;
}
