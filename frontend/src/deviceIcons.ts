// Best-effort device-type icons from data we already have on hand —
// DHCP hostname for end-client devices, Neighbor Discovery identity/platform
// for fleet-map neighbors. Deliberately keyword-based, no extra network
// calls and no MAC-vendor lookups: vendor-by-OUI already exists as an
// on-demand call in the Wi-Fi client detail modal (api.macvendors.com,
// rate-limited), and doing that for every node in a list/map view would
// multiply those calls far past what's reasonable. A wrong or missing
// guess just falls back to the caller's existing generic icon — never
// worse than what was there before.

export function guessDeviceIcon(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  const h = hostname.toLowerCase();

  if (/iphone|android|galaxy|pixel-?\d|redmi|poco\b|realme|oneplus|xperia|huawei-?p\d/.test(h)) return "📱";
  if (/ipad|-tablet|\btab-/.test(h)) return "📱";
  if (/macbook|imac\b|-laptop|notebook|thinkpad|-pc\b|\bdesktop\b/.test(h)) return "💻";
  if (/apple-?tv|chromecast|fire-?tv|\broku\b|smart-?tv|shield-?tv|android-?tv/.test(h)) return "📺";
  if (/\becho\b|alexa|homepod|google-?home|nest-?audio|\bsonos\b/.test(h)) return "🔊";
  if (/\bhue\b|smart-?bulb|\blifx\b/.test(h)) return "💡";
  if (/camera|\bcam\b|hikvision|dahua|reolink|\bwyze\b|nest-?cam|ring-?cam/.test(h)) return "📷";
  if (/\bplug\b|\bsocket\b|sonoff|shelly|\btuya\b/.test(h)) return "🔌";
  if (/thermostat|ecobee|nest-therm/.test(h)) return "🌡️";
  if (/doorbell/.test(h)) return "🔔";
  if (/printer|^hp-|canon-|epson-|brother-/.test(h)) return "🖨";
  if (/playstation|\bps[45]\b|\bxbox\b|nintendo|switch-console/.test(h)) return "🎮";
  if (/vacuum|roomba|robovac/.test(h)) return "🧹";
  if (/router|mikrotik|access-?point|^ap-/.test(h)) return "🖧";

  return null;
}

// MikroTik RouterBOARD naming conventions: cAP/wAP/SXT/LHG/Groove/Metal/
// Disc/Omnitik/BaseBox are dedicated wireless/AP-only boards; CRS/CSS are
// switches; anything else identifying as MikroTik (hAP, CCR, hEX, RB*,
// Chateau, generic "MikroTik" platform with no more specific identity) is
// treated as a router — which is also the safest default since most
// MikroTik gear on a home/office network is a router of some kind.
export function guessNeighborIcon(identity: string | null, platform: string | null): string {
  const text = `${identity ?? ""} ${platform ?? ""}`.toLowerCase();
  if (!text.trim()) return "❔";

  if (/\b(cap|wap|sxt|lhg|groove|metal|disc|omnitik|basebox|ltap)\b/.test(text) || /access-?point/.test(text)) return "📶";
  if (/\b(crs|css)\b/.test(text) || /\bswitch\b/.test(text)) return "🔌";
  if (/mikrotik|routeros|routerboard|\bccr\b|\bhex\b|\bhap\b|chateau|\brb\d/.test(text)) return "🖧";

  return "❔";
}
