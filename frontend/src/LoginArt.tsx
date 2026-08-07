// Minimal geometric illustration for the login screen — a router
// broadcasting to a small mesh of client devices. Deliberately schematic
// (not a literal product render) so it reads well at small size and matches
// the app's own flat, line-based visual language (same family as
// public/favicon.svg). Pure inline SVG, no external assets.
export default function LoginArt() {
  return (
    <svg viewBox="0 0 260 170" width="100%" height="auto" role="img" aria-label="Схема сети MikroTik">
      <defs>
        <linearGradient id="la-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b9ef5" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#5b9ef5" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="130" cy="150" rx="90" ry="14" fill="url(#la-glow)" />

      {/* wifi arcs broadcasting upward from the router */}
      <g stroke="#5b9ef5" fill="none" strokeLinecap="round">
        <path d="M104 78 A 36 36 0 0 1 156 78" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M114 78 A 24 24 0 0 1 146 78" strokeOpacity="0.4" strokeWidth="2.5" />
        <path d="M122 78 A 13 13 0 0 1 138 78" strokeOpacity="0.6" strokeWidth="2.5" />
      </g>

      {/* connection lines to client nodes */}
      <g stroke="#3a4650" strokeWidth="1.4">
        <line x1="130" y1="96" x2="46" y2="46" />
        <line x1="130" y1="96" x2="92" y2="30" />
        <line x1="130" y1="96" x2="196" y2="34" />
        <line x1="130" y1="96" x2="226" y2="70" />
        <line x1="130" y1="96" x2="200" y2="128" />
      </g>

      {/* a packet in flight along one link — subtle, degrades gracefully if
          SMIL animation isn't supported (just sits at the start point) */}
      <circle r="2.6" fill="#5fe3a6">
        <animateMotion dur="2.6s" repeatCount="indefinite" path="M130 96 L46 46" />
      </circle>
      <circle r="2.2" fill="#f5a742">
        <animateMotion dur="3.4s" begin="0.6s" repeatCount="indefinite" path="M130 96 L196 34" />
      </circle>

      {/* router body */}
      <rect x="100" y="88" width="60" height="34" rx="8" fill="#1b242b" stroke="#5b9ef5" strokeWidth="2" />
      <circle cx="113" cy="105" r="3" fill="#5fe3a6">
        <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <line x1="122" y1="105" x2="148" y2="105" stroke="#3a4650" strokeWidth="2" strokeLinecap="round" />
      <line x1="122" y1="112" x2="140" y2="112" stroke="#3a4650" strokeWidth="2" strokeLinecap="round" />

      {/* client nodes */}
      {[
        { x: 46, y: 46, c: "#5b9ef5" },
        { x: 92, y: 30, c: "#f5a742" },
        { x: 196, y: 34, c: "#5fe3a6" },
        { x: 226, y: 70, c: "#5b9ef5" },
        { x: 200, y: 128, c: "#f0556b" },
      ].map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="9" fill="#1b242b" stroke={n.c} strokeWidth="2" />
          <circle cx={n.x} cy={n.y} r="2.5" fill={n.c} />
        </g>
      ))}
    </svg>
  );
}
