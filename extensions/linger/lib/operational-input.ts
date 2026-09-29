/**
 * Pure TypeScript operational-input classifier.
 *
 * Compatible with Firstmate's wire form so existing operational rows hide under
 * Linger, plus a simple general marker any extension can use:
 *
 *   Firstmate current:
 *     U+2063 FIRSTMATE_OP: v1 <kind>: <body>
 *     [fm-from-firstmate]U+2063<body>
 *
 *   General (standalone):
 *     U+2063LINGER_HIDE: <body>
 *
 *   Legacy pi-calm marker (old sessions):
 *     U+2063CALM_HIDE: <body>
 *
 * Classification is presentation-only. Messages are never rewritten.
 */

export const INVISIBLE_SEPARATOR = "\u2063";

export const FIRSTMATE_CURRENT_OPERATIONAL_KINDS = [
  "session-start",
  "watcher",
  "turn-end-guard",
  "away-supervisor",
  "from-firstmate",
  "launch-brief",
] as const;

export type FirstmateCurrentOperationalKind =
  (typeof FIRSTMATE_CURRENT_OPERATIONAL_KINDS)[number];

const FIRSTMATE_OP_PREFIX = `${INVISIBLE_SEPARATOR}FIRSTMATE_OP: v1 `;
const FROM_FIRSTMATE_PREFIX = `[fm-from-firstmate]${INVISIBLE_SEPARATOR}`;
const LINGER_HIDE_PREFIX = `${INVISIBLE_SEPARATOR}LINGER_HIDE:`;
/** Legacy pi-calm marker kept so rows from older sessions still hide. */
const LEGACY_CALM_HIDE_PREFIX = `${INVISIBLE_SEPARATOR}CALM_HIDE:`;
/** Narrow legacy presentation shape kept for old sessions. */
const LEGACY_ESCALATE_PREFIX = `${INVISIBLE_SEPARATOR}Supervisor escalate (`;

const CURRENT_KIND_SET = new Set<string>(FIRSTMATE_CURRENT_OPERATIONAL_KINDS);

function isCurrentKind(kind: string): kind is FirstmateCurrentOperationalKind {
  return CURRENT_KIND_SET.has(kind);
}

/**
 * Encode a general Linger-hide operational user message.
 * Delivery remains an ordinary user-role message; Linger only hides its row.
 */
export function encodeLingerHideInput(body: string): string {
  const text = body.trim();
  if (!text) throw new Error("linger hide body must be non-empty");
  return `${LINGER_HIDE_PREFIX} ${text}`;
}

/**
 * Encode a Firstmate-compatible operational input.
 */
export function encodeFirstmateOperationalInput(
  kind: FirstmateCurrentOperationalKind,
  body: string,
): string {
  const text = body.trim();
  if (!text) throw new Error("operational body must be non-empty");
  if (kind === "from-firstmate") {
    return `${FROM_FIRSTMATE_PREFIX}${text}`;
  }
  if (!isCurrentKind(kind)) {
    throw new Error(`unsupported operational kind: ${kind}`);
  }
  return `${FIRSTMATE_OP_PREFIX}${kind}: ${text}`;
}

/**
 * Return a current Firstmate kind, "linger-hide", or undefined.
 * Only used for presentation classification.
 */
export function classifyOperationalText(content: string): string | undefined {
  if (!content.includes(INVISIBLE_SEPARATOR)) return undefined;

  if (content.startsWith(LINGER_HIDE_PREFIX) || content.startsWith(LEGACY_CALM_HIDE_PREFIX)) {
    const prefix = content.startsWith(LINGER_HIDE_PREFIX)
      ? LINGER_HIDE_PREFIX
      : LEGACY_CALM_HIDE_PREFIX;
    const body = content.slice(prefix.length).trimStart();
    return body ? "linger-hide" : undefined;
  }

  if (content.startsWith(FIRSTMATE_OP_PREFIX)) {
    const remainder = content.slice(FIRSTMATE_OP_PREFIX.length);
    const sep = remainder.indexOf(": ");
    if (sep <= 0) return undefined;
    const kind = remainder.slice(0, sep);
    const body = remainder.slice(sep + 2);
    if (!body || !isCurrentKind(kind) || kind === "from-firstmate") {
      return undefined;
    }
    return kind;
  }

  if (content.startsWith(FROM_FIRSTMATE_PREFIX) && content.length > FROM_FIRSTMATE_PREFIX.length) {
    return "from-firstmate";
  }

  if (content.startsWith(LEGACY_ESCALATE_PREFIX)) {
    return "legacy-operational";
  }

  return undefined;
}

/** True when the text is a text-only operational envelope Linger may zero-height. */
export function isOperationalInput(text: string): boolean {
  return classifyOperationalText(text) !== undefined;
}
