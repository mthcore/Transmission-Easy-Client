/**
 * Build an HTTP Basic Authorization header value.
 * btoa throws on non-Latin-1 input, so fall back to UTF-8 encoding
 * (what current servers, including Transmission, expect per RFC 7617).
 */
export function toBasicAuthValue(login: string, password: string): string {
  const raw = `${login}:${password}`;
  try {
    return 'Basic ' + btoa(raw);
  } catch {
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return 'Basic ' + btoa(binary);
  }
}
