// RouterOS uptime looks like "4w3d2h1m5s" — convert to seconds.
export function parseUptime(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const re = /(\d+)([wdhms])/g;
  const mult: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    total += Number(match[1]) * mult[match[2]];
  }
  return total;
}

// RouterOS reports cumulative byte counters in different shapes across
// versions/packages: sometimes a single "bytes": "rx,tx" string (confirmed
// for CAPsMAN's registration-table), sometimes separate rx-byte/tx-byte
// fields.
export function parseCounterPair(obj: any): { a: number; b: number } {
  if (typeof obj.bytes === "string" && obj.bytes.includes(",")) {
    const [a, b] = obj.bytes.split(",").map((n: string) => Number(n) || 0);
    return { a, b };
  }
  return {
    a: Number(obj["rx-byte"] ?? obj["rx-bytes"] ?? 0),
    b: Number(obj["tx-byte"] ?? obj["tx-bytes"] ?? 0),
  };
}

// Same "rx,tx" string convention as bytes, but for the packets field
// (confirmed on real CAPsMAN output: "packets":"682,355").
export function parsePacketPair(obj: any): { a: number; b: number } {
  if (typeof obj.packets === "string" && obj.packets.includes(",")) {
    const [a, b] = obj.packets.split(",").map((n: string) => Number(n) || 0);
    return { a, b };
  }
  return {
    a: Number(obj["rx-packet"] ?? obj["rx-packets"] ?? 0),
    b: Number(obj["tx-packet"] ?? obj["tx-packets"] ?? 0),
  };
}
