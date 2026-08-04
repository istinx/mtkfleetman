function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPrivateIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  const inRange = (base: string, maskBits: number) => {
    const b = ipToInt(base)!;
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("10.0.0.0", 8) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.168.0.0", 16) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16)
  );
}

function cidrContains(ip: string, cidr: string): boolean {
  const [net, maskStr] = cidr.split("/");
  const n = ipToInt(ip);
  const b = ipToInt(net);
  if (n === null || b === null) return false;
  const bits = maskStr !== undefined ? Number(maskStr) : 32;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

const VPN_NAME_PATTERN = /vpn|l2tp|pptp|sstp|ipsec|wireguard|wg|gre|eoip|ovpn/i;

export interface ChannelResult {
  category: "internal" | "vpn" | "provider" | "unknown";
  label: string;
}

// Best-effort classification of a destination IP into internal/VPN/provider
// buckets, using RFC1918 ranges plus a longest-prefix-match against the
// router's own (static/connected-only — see mikrotik/client.ts getRoutes)
// route table. Confirmed against real RouterOS output: for
// interface-based gateways (PPP/L2TP/EoIP/GRE clients etc.), the "gateway"
// field itself IS the interface name — there's no separate "interface"
// field on those routes at all.
export function classifyDestination(ip: string, routes: any[]): ChannelResult {
  if (isPrivateIp(ip)) return { category: "internal", label: "Внутренняя сеть" };

  let best: any = null;
  let bestBits = -1;
  let bestDistance = Infinity;
  for (const r of routes) {
    if (r.disabled === "true") continue;
    const dst = r["dst-address"];
    if (typeof dst !== "string") continue;
    const bits = dst.includes("/") ? Number(dst.split("/")[1]) : 32;
    if (!cidrContains(ip, dst)) continue;
    const distance = Number(r.distance ?? 1);
    // Longer prefix wins outright; on a tie, prefer the lower distance
    // (RouterOS's own tiebreaker) — real routers commonly have ECMP pairs
    // and backup routes sharing the same dst-address.
    if (bits > bestBits || (bits === bestBits && distance < bestDistance)) {
      best = r;
      bestBits = bits;
      bestDistance = distance;
    }
  }
  if (!best) return { category: "unknown", label: "Внешняя сеть" };

  const iface: string | undefined = best.interface ?? best["gateway-interface"] ?? best.gateway ?? undefined;
  if (iface && VPN_NAME_PATTERN.test(iface)) return { category: "vpn", label: `VPN (${iface})` };
  if (iface) return { category: "provider", label: `Провайдер: ${iface}` };
  return { category: "unknown", label: "Внешняя сеть" };
}
