/**
 * pi-linger — keep a Pi conversation readable while it works.
 *
 * Forked from pi-calm (which was ported from Firstmate's `/calm` extension,
 * kunchenguid/firstmate). On by default. Preference persists under the Pi
 * agent dir.
 *
 * While active:
 *   - genuine user prompts stay visible
 *   - genuine assistant text stays visible
 *   - Pi's built-in Working... activity is always visible and cannot be turned off
 *   - thinking / CoT blocks are hidden by default; `/linger thinking` shows them
 *   - tool rows stay visible for the whole agent run, then collapse when it ends
 *   - operational user rows marked with U+2063 envelopes render at zero height
 *
 * Presentation only. Delivery, tool execution, model context, session storage,
 * and /export /share content are unchanged. Export/share briefly restore stock
 * rendering for the serialization pass.
 *
 * Install:
 *   pi install /absolute/path/to/pi-linger
 *   # or: pi install npm:pi-linger
 *   # or: pi install git:github.com/<owner>/pi-linger
 *   # or copy extensions/linger → ~/.pi/agent/extensions/linger
 *   # or: pi -e ./extensions/linger/index.ts
 *
 * Usage:
 *   /linger on           Linger on, thinking hidden
 *   /linger thinking     Linger on, toggle thinking / CoT
 *   /linger off          Linger off
 *
 * Verified against Pi 0.81.1–0.87.1. Adapters probe the exact APIs they patch
 * and degrade independently if a future Pi removes a seam.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type AutocompleteItem } from "@earendil-works/pi-tui";
import { installLingerAssistantLayout } from "./lib/assistant-layout.ts";
import { installLingerOperationalUserLayout } from "./lib/operational-user-layout.ts";
import { installLingerToolExecutionLayout } from "./lib/tool-execution-layout.ts";
import { installLingerWorkingLock } from "./lib/working-lock.ts";
import {
  applyLingerPreference,
  LINGER_PRESENTATION_EVENT,
  DEFAULT_LINGER_PREFERENCE,
  getLingerPreference,
  parseLingerPreference,
  registerSyntheticPresentation,
  serializeLingerPreference,
  setAgentRunActive,
  setLingerStockExportRendering,
  type LingerPreference,
} from "./lib/visibility.ts";

// Each presentation adapter probes the exact Pi API it patches. If a future Pi
// removes that API, only the affected adapter degrades.
function installLingerPresentationAdapter(name: string, install: () => void): void {
  try {
    install();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `pi-linger: ${name} presentation adapter unavailable, skipping. ${reason}`,
    );
  }
}

function describeLingerState(preference: LingerPreference): string {
  if (!preference.active) return "Linger off — ordinary transcript restored";
  if (preference.thinking) {
    return "Linger on — tools hidden, thinking shown";
  }
  return "Linger on — tools and thinking hidden";
}

/**
 * True when the run that just ended was stopped by the user rather than
 * finishing on its own. Pi marks the final assistant message's stopReason as
 * "aborted" for manual aborts (tool rows get an "Operation aborted" error), so
 * we look at the last assistant message in the run's transcript.
 */
function agentEndWasAborted(event: { messages?: unknown }): boolean {
  const messages = event.messages;
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as
      | { role?: unknown; stopReason?: unknown }
      | undefined;
    if (!message || message.role !== "assistant") continue;
    return message.stopReason === "aborted";
  }
  return false;
}

const LINGER_COMMAND_ARGUMENTS: AutocompleteItem[] = [
  {
    value: "on",
    label: "on",
    description: "Enable Linger and hide thinking",
  },
  {
    value: "thinking",
    label: "thinking",
    description: "Keep Linger on and toggle thinking / CoT",
  },
  {
    value: "off",
    label: "off",
    description: "Disable Linger",
  },
];

export function getLingerArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  const prefix = argumentPrefix.trimStart().toLowerCase();
  // This command intentionally has exactly one argument.
  if (prefix.includes(" ")) return null;
  const matches = LINGER_COMMAND_ARGUMENTS.filter((item) =>
    item.value.startsWith(prefix),
  );
  return matches.length > 0 ? matches : null;
}

export default function (pi: ExtensionAPI) {
  installLingerPresentationAdapter("collapsed-thinking", installLingerAssistantLayout);
  installLingerPresentationAdapter(
    "operational-user-row",
    installLingerOperationalUserLayout,
  );
  // Hide tool rows once they finish; keep in-flight rows visible.
  installLingerPresentationAdapter("tool-row", installLingerToolExecutionLayout);
  // Working... is non-optional chrome for this package.
  installLingerPresentationAdapter("working-lock", installLingerWorkingLock);

  let exportRendering = false;
  let removeTerminalInputHandler: (() => void) | undefined;

  // Persist under the Pi agent dir so the preference survives sessions.
  // Override with PI_LINGER_PREFERENCE_PATH if needed.
  const preferencePath =
    process.env.PI_LINGER_PREFERENCE_PATH ||
    resolve(getAgentDir(), "linger");

  const loadLingerPreference = (): LingerPreference => {
    try {
      return parseLingerPreference(readFileSync(preferencePath, "utf8"));
    } catch {
      // Missing file → default on.
      return { ...DEFAULT_LINGER_PREFERENCE };
    }
  };

  const persistLingerPreference = (preference: LingerPreference): void => {
    mkdirSync(dirname(preferencePath), { recursive: true });
    const temporaryPath = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, serializeLingerPreference(preference), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, preferencePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  };

  const publishPresentationState = (): void => {
    const preference = getLingerPreference();
    pi.events.emit(LINGER_PRESENTATION_EVENT, {
      active: preference.active,
      thinking: preference.thinking,
      stockExportRendering: exportRendering,
    });
  };

  const applyAndRefresh = (
    preference: LingerPreference,
    ctx: ExtensionCommandContext | { ui: ExtensionCommandContext["ui"] },
  ): void => {
    applyLingerPreference(preference);
    publishPresentationState();
    // Working... is always forced on.
    ctx.ui.setWorkingVisible(true);
    // When linger hides thinking we blank the collapsed label; otherwise restore
    // Pi's default so expanded CoT / labels render normally.
    // Toggle the label once so existing AssistantMessageComponent rows re-run
    // updateContent through the linger patch (setHiddenThinkingLabel re-renders).
    const lingerQuietThinking = preference.active && !preference.thinking;
    ctx.ui.setHiddenThinkingLabel(lingerQuietThinking ? undefined : "");
    ctx.ui.setHiddenThinkingLabel(lingerQuietThinking ? "" : undefined);
    ctx.ui.setStatus("pi-linger", undefined);

    // Rebuild controllable rows, preserve Ctrl+O expansion state.
    const expanded = ctx.ui.getToolsExpanded();
    ctx.ui.setToolsExpanded(!expanded);
    ctx.ui.setToolsExpanded(expanded);
  };

  const setPreference = (
    preference: LingerPreference,
    ctx: ExtensionCommandContext,
    notify = true,
  ): void => {
    persistLingerPreference(preference);
    applyAndRefresh(preference, ctx);
    if (notify && ctx.hasUI) {
      ctx.ui.notify(describeLingerState(preference), "info");
    }
  };

  registerSyntheticPresentation(pi);

  pi.on("session_start", (_event, ctx) => {
    exportRendering = false;
    setLingerStockExportRendering(false);
    // A resumed or reloaded session that is still streaming counts as an
    // active run, so its in-flight tool rows never collapse early.
    setAgentRunActive(!ctx.isIdle());
    applyAndRefresh(loadLingerPreference(), ctx);
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = ctx.ui.onTerminalInput((data) => {
      if (!getKeybindings().matches(data, "tui.input.submit")) {
        return undefined;
      }

      const input = ctx.ui.getEditorText().trim();
      if (
        input !== "/share" &&
        input !== "/export" &&
        !input.startsWith("/export ")
      ) {
        return undefined;
      }

      // Briefly restore stock rendering so export/share capture full chrome.
      exportRendering = true;
      setLingerStockExportRendering(true);
      publishPresentationState();
      setTimeout(() => {
        exportRendering = false;
        setLingerStockExportRendering(false);
        publishPresentationState();
        // Force controllable rows to rebuild, then restore Ctrl+O state.
        const expanded = ctx.ui.getToolsExpanded();
        ctx.ui.setToolsExpanded(!expanded);
        ctx.ui.setToolsExpanded(expanded);
        // Re-assert Working... after export serialization.
        ctx.ui.setWorkingVisible(true);
      }, 0);

      // Do not consume the submit key; Pi still needs to execute /share or /export.
      return undefined;
    });
  });

  // Tool rows stay visible for the whole run; hide them only when it is over.
  pi.on("agent_start", () => {
    setAgentRunActive(true);
  });

  pi.on("agent_end", (event, ctx) => {
    // An automatic retry continues the same logical run. Wait for the real end.
    if ((event as { willRetry?: boolean }).willRetry === true) return;
    // A manual abort ends the run without finishing it. Keep the visibility
    // window open so the interrupted tool rows stay on screen for inspection;
    // the next normal run's agent_end closes the window and collapses them.
    if (agentEndWasAborted(event)) {
      setAgentRunActive(true);
      ctx.ui.setWorkingVisible(true);
      return;
    }
    setAgentRunActive(false);
    // Rebuild tool rows so everything finished during this run collapses now.
    const expanded = ctx.ui.getToolsExpanded();
    ctx.ui.setToolsExpanded(!expanded);
    ctx.ui.setToolsExpanded(expanded);
    ctx.ui.setWorkingVisible(true);
  });

  pi.registerCommand("linger", {
    description:
      "Linger transcript: /linger on, /linger thinking, or /linger off. Working... always stays on.",
    getArgumentCompletions: getLingerArgumentCompletions,
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();
      const current = getLingerPreference();

      if (argument === "on") {
        // /linger on always means Linger on with thinking hidden.
        setPreference({ active: true, thinking: false }, ctx);
        return;
      }

      if (argument === "thinking") {
        // /linger thinking enables Linger and toggles CoT visibility.
        setPreference(
          {
            active: true,
            thinking: current.active ? !current.thinking : true,
          },
          ctx,
        );
        return;
      }

      if (argument === "off") {
        setPreference({ active: false, thinking: false }, ctx);
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /linger on | /linger thinking | /linger off",
          "warning",
        );
      }
    },
  });
}
