# pi-linger

A calmer way to read [Pi](https://github.com/badlogic/pi-mono) while it works.

[简体中文](README.zh-CN.md)

**pi-linger** keeps the conversation and Pi's `Working...` status easy to follow,
while quietly tucking away tool chatter and optional thinking. Tool rows stay
visible for the whole agent run and collapse only once the run is over. It
changes only what you see in the terminal — tool execution, model context, and
session data stay untouched.

> Forked from [pi-calm](https://github.com/JesseZhang97/pi-calm) by Jesse Zhang
> (itself ported from Firstmate's `/calm` extension). The main behavioral change
> is that tool rows hide at the end of a whole agent run instead of the moment
> each individual tool call returns. See [Changes from pi-calm](#changes-from-pi-calm).

## What stays visible

Linger is **on by default**:

| Stays visible | Quietly hidden (presentation only) |
| --- | --- |
| Genuine user prompts | Thinking / CoT blocks (unless `/linger thinking`) |
| Genuine assistant text | Tool rows (built-in and user-defined) — after the run ends |
| Pi's native `Working...` row (always on, cannot be disabled) | Operational user rows marked with `U+2063` envelopes |

Tool rows are **not** hidden while Pi is working: arguments streaming, running
calls, partial output, and finished calls all stay on screen for the entire
agent run. When the run ends (the final answer is in), every tool row from that
run collapses to zero height, and stays collapsed for the rest of the session.

Hidden content remains in the session and comes back when you turn Linger off.
`/export` and `/share` briefly restore Pi's normal rendering so exported content
remains complete.

## Changes from pi-calm

- Tool rows are hidden per **agent run**, not per tool call. A run is one prompt
  through the whole model/tool loop until the final answer; `agent_start` opens
  the window and `agent_end` closes it (automatic retries keep it open).
- Rows are latched once hidden, so tool rows from earlier runs never reappear
  when a new run starts.
- Legacy `U+2063CALM_HIDE:` operational markers from old pi-calm sessions are
  still recognized.

## Install

### GitHub

```sh
pi install git:github.com/sg8010/pi-linger
```

### npm

```sh
pi install npm:pi-linger
```

### Local path

```sh
pi install /path/to/pi-linger
```

This package declares the `pi-package` keyword and a `pi` manifest, so Pi's
package gallery can discover it.

After installing, restart Pi or run `/reload`.

## Usage

```text
/linger on              # Linger on, thinking hidden
/linger thinking        # Keep Linger on, toggle thinking / CoT
/linger off             # Linger off, ordinary transcript restored
```

Those are the only three commands. Typing `/linger ` offers argument completion.

`Working...` always stays visible and cannot be disabled while the extension is
loaded.

## Preferences

Saved by default at:

```text
~/.pi/agent/linger
```

| File contents | Meaning |
| --- | --- |
| `on` | Linger on, thinking hidden (default) |
| `on thinking` | Linger on, thinking / CoT shown |
| `off` | Linger off |

Override the path with `PI_LINGER_PREFERENCE_PATH`.

## Presentation scope

Linger uses Pi's presentation seams:

- Every `ToolExecutionComponent` row is targeted, including any third-party
  custom tool.
- Custom messages and custom entries still show.
- Compaction / branch summaries still show.
- `!` / `!!` user bash rows still show.
- `/export` and `/share` temporarily restore stock rendering for serialization.

Hiding is presentation-only; session data is never deleted.

## Development

This is a Pi extension package; there is no build step. Point Pi at the package
and reload:

```sh
pi -e ./extensions/linger/index.ts
```

## License

MIT. See [LICENSE](LICENSE). Original work Copyright (c) 2025 Jesse Zhang.
