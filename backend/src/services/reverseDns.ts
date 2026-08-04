import dns from "dns";

const cache = new Map<string, string | null>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Reverse-resolves an IP to a hostname for display purposes only (e.g.
// "142.250.x.x" -> "waw07s01-in-f14.1e100.net"). Never throws; returns null
// on any failure or timeout, and caches both hits and misses in memory for
// the life of the process to avoid repeat lookups.
export async function reverseDnsBestEffort(ip: string): Promise<string | null> {
  if (cache.has(ip)) return cache.get(ip)!;
  try {
    const names = await withTimeout(dns.promises.reverse(ip), 700);
    const result = names[0] ?? null;
    cache.set(ip, result);
    return result;
  } catch {
    cache.set(ip, null);
    return null;
  }
}
