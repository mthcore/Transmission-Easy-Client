/**
 * Loopback / private / link-local host detection.
 *
 * The background service worker holds host permissions for every http(s) origin
 * and is exempt from CORS, so a redirect chain started from a user-clicked link
 * could otherwise reach a router admin page, a localhost service or a cloud
 * metadata endpoint and hand its contents to the configured (possibly remote)
 * Transmission daemon. The user's own daemon is fetched by a different path
 * (the RPC transport), so refusing these here costs nothing.
 */

const PRIVATE_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', '[::1]', '::1']);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/**
 * Dotted-quad carried in the low 32 bits of an IPv4-mapped (::ffff:0:0/96) or
 * NAT64 (64:ff9b::/96) address. URL parsing rewrites '[::ffff:127.0.0.1]' as
 * '[::ffff:7f00:1]', so the textual form alone never matches an IPv4 rule.
 */
function embeddedIpv4(address: string): string | null {
  const match = /^(?:::ffff:|64:ff9b::)(.+)$/.exec(address);
  if (!match) return null;
  const tail = match[1];
  // A literal dotted quad needs no rewrite; isPrivateIpv4 validates it
  if (tail.includes('.')) return tail;
  const groups = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!groups) return null;
  const high = parseInt(groups[1], 16);
  const low = parseInt(groups[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

function isPrivateIpv6(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (address === '::1' || address === '::') return true;
  // An IPv4 address wearing an IPv6 hat reaches exactly the same machine, so
  // '[::ffff:127.0.0.1]' has to be refused wherever '127.0.0.1' is
  const embedded = embeddedIpv4(address);
  if (embedded) return isPrivateIpv4(embedded);
  // Unique-local (fc00::/7) and link-local (fe80::/10)
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

export default function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost')) return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  return isPrivateIpv4(host);
}
