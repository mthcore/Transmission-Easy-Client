/**
 * Build an HTTP Basic Authorization header value.
 * Credentials are always encoded as UTF-8 (what current servers, including
 * Transmission, expect per RFC 7617). Encoding through btoa alone would emit
 * Latin-1 bytes for U+0080–U+00FF characters (e.g. "café") and throw above
 * U+00FF, so the byte string is built explicitly from the UTF-8 encoding.
 */
export function toBasicAuthValue(login: string, password: string): string {
  const bytes = new TextEncoder().encode(`${login}:${password}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return 'Basic ' + btoa(binary);
}
