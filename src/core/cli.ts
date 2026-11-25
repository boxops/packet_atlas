/**
 * Command-line helpers for the device console: network-OS style abbreviations
 * ("sh int br" → "show interfaces brief"), Tab completion and built-in commands.
 */

export const BUILTINS = ['help', 'clear', 'history', 'exit'];

export type Resolution = { ok: true; cmd: string } | { ok: false; error: string };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Resolve typed input to exactly one known command, allowing per-word prefixes. */
export function resolveCommand(input: string, commands: string[]): Resolution {
  const typed = input.trim().replace(/\s+/g, ' ');
  if (!typed) return { ok: false, error: '' };
  const exact = commands.find((c) => c.toLowerCase() === typed.toLowerCase());
  if (exact) return { ok: true, cmd: exact };
  const tw = words(typed.toLowerCase());
  const matches = commands.filter((c) => {
    const cw = words(c.toLowerCase());
    return cw.length === tw.length && cw.every((w, i) => w.startsWith(tw[i]));
  });
  if (matches.length === 1) return { ok: true, cmd: matches[0] };
  if (matches.length > 1) return { ok: false, error: `% Ambiguous command: "${typed}"\n  Could be: ${matches.join(', ')}` };
  return { ok: false, error: `% Invalid input detected: "${typed}"\n  Type "help" or "?" to list available commands.` };
}

export interface Completion {
  /** New input text (unchanged when there is nothing to add). */
  value: string;
  /** Candidates to show when the input is ambiguous. */
  options: string[];
}

/** Tab completion: complete the current (last) word against commands consistent with earlier words. */
export function complete(input: string, commands: string[]): Completion {
  const endsWithSpace = /\s$/.test(input);
  const tw = words(input.toLowerCase());
  const done = endsWithSpace ? tw : tw.slice(0, -1);
  const partial = endsWithSpace ? '' : (tw.at(-1) ?? '');
  const candidates = commands.filter((c) => {
    const cw = words(c.toLowerCase());
    return cw.length > done.length && done.every((w, i) => cw[i].startsWith(w)) && cw[done.length].startsWith(partial);
  });
  if (!candidates.length) return { value: input, options: [] };
  // Next words that the candidates offer at this position.
  const nextWords = [...new Set(candidates.map((c) => words(c)[done.length]))];
  const prefix = done.map((_, i) => words(candidates[0])[i]).join(' ');
  const lead = prefix ? `${prefix} ` : '';
  if (candidates.length === 1) return { value: candidates[0] + ' ', options: [] };
  if (nextWords.length === 1) return { value: `${lead}${nextWords[0]} `, options: [] };
  // Extend to the longest common prefix of the possible next words.
  let common = nextWords[0];
  for (const w of nextWords) while (!w.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
  const value = common.length > partial.length ? `${lead}${common}` : input;
  return { value, options: candidates };
}
