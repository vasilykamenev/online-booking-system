/**
 * Pure IPv4/IPv6 private/reserved-range checks — the core of the SSRF guard in `safe-fetch.ts`.
 * No dependency on `net`/`dns` here on purpose, so this half of the guard is unit-testable without
 * touching the network.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

interface Cidr4 {
  base: number;
  maskBits: number;
}

function cidr4(range: string): Cidr4 {
  const [base, bits] = range.split("/");
  const value = ipv4ToInt(base);
  if (value === null) throw new Error(`invalid CIDR literal: ${range}`);
  return { base: value, maskBits: Number(bits) };
}

// RFC 1918 private ranges, loopback, link-local, "this network", CGNAT, and multicast/reserved —
// everything a redirect or DNS answer could point at to reach something that isn't the public
// internet. Not exhaustive of every IANA special-purpose block, but covers what an attacker
// controlling a target site's DNS or redirect chain could realistically use to reach internal
// infrastructure from a server that fetches "public" URLs.
const IPV4_BLOCKED_RANGES: Cidr4[] = [
  cidr4("0.0.0.0/8"),
  cidr4("10.0.0.0/8"),
  cidr4("100.64.0.0/10"), // CGNAT
  cidr4("127.0.0.0/8"),
  cidr4("169.254.0.0/16"), // link-local, incl. cloud metadata endpoints (169.254.169.254)
  cidr4("172.16.0.0/12"),
  cidr4("192.0.0.0/24"),
  cidr4("192.168.0.0/16"),
  cidr4("198.18.0.0/15"),
  cidr4("224.0.0.0/4"), // multicast
  cidr4("240.0.0.0/4"), // reserved
];

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return IPV4_BLOCKED_RANGES.some(({ base, maskBits }) => {
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

/**
 * IPv6 loopback, unspecified, link-local, and unique-local — plus IPv4-mapped addresses
 * (`::ffff:a.b.c.d`), which must be unwrapped and checked against the IPv4 ranges above rather
 * than waved through just because they're spelled as IPv6.
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/.test(normalized)) return true; // unique local (fc00::/7)

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

export function isPrivateIp(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}
