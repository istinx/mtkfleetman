import { pool } from "../db/pool";

function ouiOf(mac: string): string {
  return mac.toUpperCase().slice(0, 8); // "AA:BB:CC:DD:EE:FF" -> "AA:BB:CC"
}

// Looks up the manufacturer for a MAC address's OUI (first 3 octets),
// caching results in Postgres indefinitely — this mapping is static. A
// lookup miss due to no internet access is NOT cached, so it's retried
// next time rather than permanently showing "unknown".
export async function getVendorForMac(mac: string): Promise<string | null> {
  const oui = ouiOf(mac);
  const { rows } = await pool.query("SELECT vendor FROM mac_vendors WHERE oui = $1", [oui]);
  if (rows.length) return rows[0].vendor;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.macvendors.com/${mac}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 404) {
      // Definitive "no vendor registered for this OUI" — worth caching.
      await pool.query("INSERT INTO mac_vendors (oui, vendor) VALUES ($1, NULL) ON CONFLICT (oui) DO NOTHING", [oui]);
      return null;
    }
    if (!res.ok) return null; // rate-limited or transient — don't cache, try again next time

    const vendor = (await res.text()).trim();
    if (!vendor) return null;
    await pool.query(
      "INSERT INTO mac_vendors (oui, vendor) VALUES ($1, $2) ON CONFLICT (oui) DO UPDATE SET vendor = $2",
      [oui, vendor]
    );
    return vendor;
  } catch {
    return null; // no internet access from this container, or the API is down — don't cache
  }
}
