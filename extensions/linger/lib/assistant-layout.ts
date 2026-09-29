/**
 * Zero-height thinking / CoT presentation adapter.
 *
 * Verified against Pi 0.81.1–0.82.1 exports of AssistantMessageComponent with
 * updateContent. Probes that exact method and throws if missing so the main
 * extension can skip only this adapter with a diagnostic.
 *
 * Presentation-only: filters thinking blocks from a shallow copy used for
 * layout while Pi still holds the original message for expansion/invalidation.
 * When linger is on and `/linger thinking` has enabled CoT, thinking blocks pass
 * through expanded (hideThinkingBlock forced off for that layout pass).
 *
 * Reinstall-safe: always rebinds the outermost prototype wrapper so a code
 * upgrade after `/reload` still filters thinking even if an older linger patch
 * remains underneath (e.g. one that required hideThinkingBlock === true).
 */
import type { AssistantMessageComponent as PiAssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import {
  lingerPresentationHides,
  lingerPresentationIsActive,
} from "./visibility.ts";

type AssistantMessage = Parameters<
  PiAssistantMessageComponent["updateContent"]
>[0];

type AssistantMessagePresentationState = {
  hideThinkingBlock?: boolean;
  lastMessage?: AssistantMessage;
};

type LingerAssistantLayoutPatch = {
  hidesThinking: () => boolean;
  showsExpandedThinking: () => boolean;
};

type UpdateContentFn = (message: AssistantMessage) => void;

// Versioned symbols: bump when wrapper body changes so upgrades rebind cleanly.
const LINGER_ASSISTANT_LAYOUT_PATCH = Symbol.for(
  "pi-linger:assistant-layout:patch:v3",
);
const LINGER_ASSISTANT_LAYOUT_ORIGINAL = Symbol.for(
  "pi-linger:assistant-layout:original-updateContent:v3",
);

function isThinkingBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "thinking"
  );
}

export function installLingerAssistantLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: LingerAssistantLayoutPatch | UpdateContentFn | undefined;
  };
  const hidesThinking = (): boolean =>
    lingerPresentationHides("assistant-thinking");
  const showsExpandedThinking = (): boolean =>
    lingerPresentationIsActive() && !hidesThinking();

  const AssistantMessageComponent = PiCodingAgent.AssistantMessageComponent;
  if (typeof AssistantMessageComponent !== "function") {
    throw new Error("pi-linger requires Pi AssistantMessageComponent");
  }
  const prototype = AssistantMessageComponent.prototype as {
    updateContent: UpdateContentFn;
  };
  if (typeof prototype.updateContent !== "function") {
    throw new Error(
      "pi-linger requires Pi AssistantMessageComponent.updateContent",
    );
  }

  // Capture the next function in the chain once per process. This may be Pi's
  // real updateContent or an older linger wrapper; either is fine because the
  // outermost wrapper below always strips thinking first when linger hides it.
  if (typeof registry[LINGER_ASSISTANT_LAYOUT_ORIGINAL] !== "function") {
    registry[LINGER_ASSISTANT_LAYOUT_ORIGINAL] = prototype.updateContent;
  }

  const existing = registry[LINGER_ASSISTANT_LAYOUT_PATCH] as
    | LingerAssistantLayoutPatch
    | undefined;
  const patch: LingerAssistantLayoutPatch = existing ?? {
    hidesThinking,
    showsExpandedThinking,
  };
  patch.hidesThinking = hidesThinking;
  patch.showsExpandedThinking = showsExpandedThinking;
  registry[LINGER_ASSISTANT_LAYOUT_PATCH] = patch;

  const originalUpdateContent = registry[
    LINGER_ASSISTANT_LAYOUT_ORIGINAL
  ] as UpdateContentFn;

  // Always rebind so upgraded logic wins after /reload without process restart.
  prototype.updateContent = function (
    this: AssistantMessagePresentationState,
    message: AssistantMessage,
  ): void {
    const hideThinking = patch.hidesThinking();
    const presentationMessage = hideThinking
      ? {
          ...message,
          content: message.content.filter((block) => !isThinkingBlock(block)),
        }
      : message;

    // Under `/linger thinking`, force expanded CoT for this layout pass even if
    // the user has hideThinkingBlock enabled in Pi settings.
    const previousHideBlock = this.hideThinkingBlock;
    const forceExpand = patch.showsExpandedThinking();
    if (forceExpand) this.hideThinkingBlock = false;

    originalUpdateContent.call(this, presentationMessage);

    if (forceExpand) this.hideThinkingBlock = previousHideBlock;
    // Keep the original message so toggling thinking back on can re-render CoT.
    if (presentationMessage !== message) this.lastMessage = message;
  };
}
