/**
 * Zero-height tool-row presentation adapter.
 *
 * registerTool() can lose to another extension under Pi's first-wins tool
 * ownership. This adapter patches ToolExecutionComponent.render so tool rows
 * stay hidden under Linger regardless of which extension owns the tool
 * definition.
 *
 * Linger keeps every tool row visible for the whole agent run (arguments
 * streaming, executing, partial output, and finished calls) and collapses the
 * rows to zero height only once that run is over. A row that has been hidden
 * stays hidden, so tool rows from earlier runs never reappear when a new run
 * starts. When the user aborts a run the window stays open (see index.ts), so
 * the interrupted rows remain visible until the next normal run ends.
 *
 * Presentation only. Execution, results, and session storage are unchanged.
 */
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { agentRunIsActive, lingerPresentationHides } from "./visibility.ts";

type ToolExecutionPresentation = {
  render(width: number): string[];
  /** Pi's flag: true until the final (non-partial) result arrives. */
  isPartial?: boolean;
  /** Set once the tool produced output; undefined before that. */
  result?: unknown;
  /** Linger's latch: once set, this row stays hidden for the session. */
  lingerRowHidden?: boolean;
};

type LingerToolExecutionLayoutPatch = {
  hidesTools: () => boolean;
};

const LINGER_TOOL_EXECUTION_LAYOUT_PATCH = Symbol.for(
  "pi-linger:tool-execution-layout:pi-0.81.1",
);
const LINGER_TOOL_EXECUTION_LAYOUT_ORIGINAL_RENDER = Symbol.for(
  "pi-linger:tool-execution-layout:original-render:pi-0.81.1",
);

type ToolRenderFn = (
  this: ToolExecutionPresentation,
  width: number,
) => string[];

type LingerToolExecutionLayoutRegistry = {
  [key: symbol]:
    | LingerToolExecutionLayoutPatch
    | ToolRenderFn
    | undefined;
};

/**
 * A tool row counts as finished only once Pi marks its result final
 * (isPartial === false) and a result exists. Pending, executing, and
 * streaming-partial rows are still in flight and stay visible.
 */
function toolRowIsFinished(component: ToolExecutionPresentation): boolean {
  if (component.isPartial === true) return false;
  return component.result !== undefined && component.result !== null;
}

/**
 * Decide whether a tool row should collapse to zero height.
 *
 * While an agent run is active every row stays visible, finished or not. Once
 * the run is over each finished row is latched hidden so it cannot come back
 * during a later run. A running row is never latched, which also keeps rows
 * visible if the extension is reloaded mid-run.
 */
function shouldHideToolRow(component: ToolExecutionPresentation): boolean {
  if (component.lingerRowHidden) return true;
  if (agentRunIsActive()) return false;
  if (!toolRowIsFinished(component)) return false;
  component.lingerRowHidden = true;
  return true;
}

export function installLingerToolExecutionLayout(): void {
  const registry = globalThis as typeof globalThis &
    LingerToolExecutionLayoutRegistry;
  const hidesTools = (): boolean =>
    lingerPresentationHides("assistant-tool-call");

  const ToolExecutionComponent = (
    PiCodingAgent as typeof PiCodingAgent & {
      ToolExecutionComponent?: new (...args: never[]) => ToolExecutionPresentation;
    }
  ).ToolExecutionComponent;
  if (typeof ToolExecutionComponent !== "function") {
    throw new Error("pi-linger requires Pi ToolExecutionComponent");
  }

  const prototype = ToolExecutionComponent.prototype as ToolExecutionPresentation;
  if (typeof prototype.render !== "function") {
    throw new Error("pi-linger requires Pi ToolExecutionComponent.render");
  }

  // Capture Pi's real render exactly once. `/reload` re-imports this module, so
  // the "original" must never become a previous linger wrapper.
  if (
    typeof registry[LINGER_TOOL_EXECUTION_LAYOUT_ORIGINAL_RENDER] !== "function"
  ) {
    registry[LINGER_TOOL_EXECUTION_LAYOUT_ORIGINAL_RENDER] =
      prototype.render as ToolRenderFn;
  }
  const originalRender = registry[
    LINGER_TOOL_EXECUTION_LAYOUT_ORIGINAL_RENDER
  ] as ToolRenderFn;

  const patch: LingerToolExecutionLayoutPatch = { hidesTools };
  registry[LINGER_TOOL_EXECUTION_LAYOUT_PATCH] = patch;

  // Always rebind. After `/reload` a new module instance owns the live
  // visibility state, so the wrapper must close over this import's
  // `shouldHideToolRow` / `agentRunIsActive` instead of a stale one. The
  // captured original keeps repeated installs from stacking wrappers.
  prototype.render = function (
    this: ToolExecutionPresentation,
    width: number,
  ): string[] {
    if (patch.hidesTools() && shouldHideToolRow(this)) {
      return [];
    }
    return originalRender.call(this, width);
  };
}
