import type { TransmissionResponse } from '../bg/TransmissionTransport';

/**
 * Some daemons/trackers emit raw control characters or invalid escape
 * sequences inside string values (announce, scrape, lastAnnounceResult, ...),
 * which makes strict JSON.parse throw. Repair string literals only, without
 * touching the document structure.
 */
function repairJsonStrings(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        out += '\\\\';
        i += 1;
        continue;
      }
      if ('"\\/bfnrt'.includes(next)) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += text.slice(i, i + 6);
          i += 6;
          continue;
        }
        // Invalid \u sequence: escape the backslash, keep the rest as text
        out += '\\\\u';
        i += 2;
        continue;
      }
      // Invalid escape: escape the backslash itself
      out += '\\\\';
      i += 1;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Strict JSON.parse with a string-literal repair fallback. Rethrows the
 * original parse error when the repaired text still isn't valid JSON.
 */
export function parseTransmissionResponse(text: string): TransmissionResponse {
  try {
    return JSON.parse(text);
  } catch (originalError) {
    try {
      return JSON.parse(repairJsonStrings(text));
    } catch {
      throw originalError;
    }
  }
}
