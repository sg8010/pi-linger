import {
  getMarkdownTheme,
  type ExtensionAPI,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

/** Audited transcript classes Linger may control when Pi exposes a renderer. */
export const LINGER_TRANSCRIPT_CLASSES = [
  "genuine-user-prompt",
  "genuine-agent-response",
  "assistant-thinking",
  "assistant-tool-call",
  "tool-result",
  "tool-image",
  "user-bash",
  "skill-invocation",
  "custom-message",
  "custom-entry",
  "compaction-summary",
  "branch-summary",
  "working-status",
  "command-status",
  "system-notice",
  "cache-notice",
  "project-trust-warning",
  "synthetic-user",
  "synthetic-assistant",
  "unknown",
] as const;

export type LingerTranscriptClass = (typeof LINGER_TRANSCRIPT_CLASSES)[number];

/** Classes that stay visible while Linger is active (thinking is optional). */
const LINGER_VISIBLE_CLASSES = new Set<LingerTranscriptClass>([
  "genuine-user-prompt",
  "genuine-agent-response",
  "working-status",
]);

/**
 * Legacy custom-entry type from the early Firstmate Calm era.
 * Current operational input stays ordinary user-role messages.
 */
export const LINGER_SYNTHETIC_PRESENTATION_TYPE =
  "firstmate-synthetic-input-presentation";

/** Cross-extension presentation state event. */
export const LINGER_PRESENTATION_EVENT = "pi-linger:presentation";

export type LingerPresentationState = {
  active: boolean;
  /** When linger is on, whether thinking / CoT blocks are shown. */
  thinking: boolean;
  stockExportRendering: boolean;
};

export type LingerPreference = {
  active: boolean;
  thinking: boolean;
};

export type SyntheticPresentation = {
  content: string;
  kind?: string;
};

/** Default: linger on, thinking hidden, Working... always on. */
export const DEFAULT_LINGER_PREFERENCE: LingerPreference = {
  active: true,
  thinking: false,
};

let linger = DEFAULT_LINGER_PREFERENCE.active;
let thinkingVisible = DEFAULT_LINGER_PREFERENCE.thinking;
let stockExportRendering = false;

/**
 * Whether a full agent run is in progress.
 *
 * One "run" is a single prompt followed by the whole model/tool loop until the
 * final answer, retries included. Linger keeps tool rows visible for the entire
 * run and only collapses them once the run is over, instead of hiding each row
 * as soon as its individual tool call returns.
 */
let agentRunActive = false;

export function setAgentRunActive(active: boolean): void {
  agentRunActive = active;
}

export function agentRunIsActive(): boolean {
  return agentRunActive;
}

export function lingerTranscriptClassIsVisible(
  itemClass: LingerTranscriptClass,
): boolean {
  if (itemClass === "assistant-thinking" && thinkingVisible) return true;
  return LINGER_VISIBLE_CLASSES.has(itemClass);
}

export function setLingerPresentation(active: boolean): void {
  linger = active;
}

export function setLingerThinkingVisible(visible: boolean): void {
  thinkingVisible = visible;
}

export function setLingerStockExportRendering(active: boolean): void {
  stockExportRendering = active;
}

export function lingerPresentationIsActive(): boolean {
  return linger;
}

export function lingerThinkingIsVisible(): boolean {
  return thinkingVisible;
}

export function getLingerPreference(): LingerPreference {
  return { active: linger, thinking: thinkingVisible };
}

/**
 * Apply a full preference snapshot to the in-memory presentation flags.
 * Does not touch stockExportRendering.
 */
export function applyLingerPreference(preference: LingerPreference): void {
  linger = preference.active;
  thinkingVisible = preference.thinking;
}

export function lingerPresentationHides(itemClass: LingerTranscriptClass): boolean {
  return (
    linger && !stockExportRendering && !lingerTranscriptClassIsVisible(itemClass)
  );
}

/**
 * Parse preference file contents.
 * Supported:
 *   on              → linger on, thinking hidden (default shape)
 *   on thinking     → linger on, thinking / CoT shown
 *   off             → linger off
 * Legacy bare "on" / "off" (with optional trailing whitespace/newlines) still work.
 * Missing / empty / unreadable → DEFAULT_LINGER_PREFERENCE (on).
 */
export function parseLingerPreference(text: string): LingerPreference {
  const normalized = text
    .trim()
    .toLowerCase()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  if (!normalized) return { ...DEFAULT_LINGER_PREFERENCE };

  if (normalized === "off") {
    return { active: false, thinking: false };
  }

  if (
    normalized === "on thinking" ||
    normalized === "on+thinking" ||
    normalized === "on thinking:on" ||
    normalized === "on thinking=on"
  ) {
    return { active: true, thinking: true };
  }

  if (normalized === "on" || normalized.startsWith("on ")) {
    // "on" or "on thinking off" etc. — only explicit thinking tokens enable CoT
    const thinking =
      /\bthinking\b/.test(normalized) &&
      !/\bthinking\s*(:|=)?\s*off\b/.test(normalized) &&
      !/\bthinking\s+hidden\b/.test(normalized);
    return { active: true, thinking };
  }

  return { ...DEFAULT_LINGER_PREFERENCE };
}

export function serializeLingerPreference(preference: LingerPreference): string {
  if (!preference.active) return "off\n";
  if (preference.thinking) return "on thinking\n";
  return "on\n";
}

/**
 * Register a zero-height-capable renderer for legacy synthetic custom entries.
 * When Linger is on, returning undefined drops the complete row with no residual spacer.
 */
export function registerSyntheticPresentation(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<SyntheticPresentation>(
    LINGER_SYNTHETIC_PRESENTATION_TYPE,
    (entry) => {
      if (lingerPresentationHides("synthetic-user")) return undefined;
      const data = entry.data;
      if (!data || typeof data.content !== "string") return undefined;
      return new UserMessageComponent(data.content, getMarkdownTheme());
    },
  );
}
