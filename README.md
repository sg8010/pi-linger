# pi-linger

让 [Pi](https://github.com/badlogic/pi-mono) 工作时更清爽、更容易跟进。

**pi-linger** 保留对话内容和 `Working...` 状态，同时把工具执行噪音和可选的思考内容安静地收起来。工具行在整轮 agent run 期间保持显示，等到这一轮 run 结束才收起。它只改变终端展示，不会改变工具执行、模型上下文或 session 数据。

> Fork 自 Jesse Zhang 的 [pi-calm](https://github.com/JesseZhang97/pi-calm)（pi-calm 又源自 Firstmate 的 `/calm` 扩展）。主要行为差异是：工具行在**整轮 agent run 结束**时才隐藏，而不是某个工具调用一结束就隐藏。详见[与 pi-calm 的差异](#与-pi-calm-的差异)。

## 保留什么，隐藏什么

Linger **默认开启**：

| 保留显示 | 收起（仅展示层） |
| --- | --- |
| 用户真实提示 | 思考 / CoT 区块（`/linger thinking` 可显示） |
| 助手真实文本 | 工具行（内置工具和自定义 custom tools）—— run 结束后 |
| Pi 原生 `Working...` 行（始终开启，无法关闭） | 带 `U+2063` envelope 的操作型用户行 |

Pi 工作期间工具行**不会**隐藏：参数流式输出、执行中的调用、部分结果、已结束的调用，在整轮 agent run 期间都留在屏幕上。当这一轮 run 结束（最终回答产出）后，本轮的所有工具行才收起为零高度，并在本 session 内保持收起。

如果这一轮 run 是用户手动终止（abort）的，本轮工具行**不会**立即收起：被中断的工具调用过程会保留在屏幕上，直到下一次正常的 run 结束（或本 session 结束）时才一起收起，方便查看终止前发生了什么。

隐藏内容仍会保存在 session 中，关闭 Linger 后会恢复显示。`/export` 和 `/share` 序列化时会临时恢复标准展示，保证导出内容完整。

## 与 pi-calm 的差异

- 工具行按**整轮 agent run**隐藏，而不是按单次工具调用。一轮 run 指一次提示经过完整的「模型 / 工具」循环直到最终回答；`agent_start` 打开显示窗口，`agent_end` 关闭它（自动重试期间保持打开）。
- 用户手动终止（abort）时不会立即关闭显示窗口：这一轮的工具行保持可见，直到下一次正常 run 结束时才一起收起。
- 收起后会被锁定，因此新一轮 run 开始时，之前 run 的工具行不会重新出现。
- 仍然识别旧 pi-calm session 中的 `U+2063CALM_HIDE:` 操作型标记。

## 安装

```sh
pi install git:github.com/sg8010/pi-linger
```

本包包含 `pi-package` keyword 和 `pi` manifest，可以被 Pi package gallery 发现。

安装后重启 Pi，或执行 `/reload`。

## 使用

```text
/linger on              # Linger 开启，隐藏思考（默认）
/linger thinking        # Linger 开启，显示思考 / CoT
/linger off             # Linger 关闭
```

只有这三个命令。输入 `/linger ` 后，Pi 会提供参数补全。

`Working...` 始终保持显示，扩展加载后不能被关闭。

## 偏好设置

默认保存于：

```text
~/.pi/agent/linger
```

| 文件内容 | 含义 |
| --- | --- |
| `on` | Linger 开启，隐藏思考（默认） |
| `on thinking` | Linger 开启，显示思考 / CoT |
| `off` | Linger 关闭 |

可通过 `PI_LINGER_PREFERENCE_PATH` 覆盖保存路径。

## 展示范围

Linger 使用 Pi 的展示层 seam：

- 所有 `ToolExecutionComponent` 工具行都会被接管，包括任意第三方 custom tools
- custom messages 和 custom entries 仍然显示
- compaction / branch summary 仍然显示
- `!` / `!!` 用户 bash 行仍然显示
- `/export` 和 `/share` 序列化时会临时恢复标准展示

隐藏只影响终端展示，不会删除 session 数据。

## 开发

这是一个 Pi extension 包，没有构建步骤。直接用 Pi 指向它并重载：

```sh
pi -e ./extensions/linger/index.ts
```

## License

MIT，见 [LICENSE](LICENSE)。原始作品版权归 Jesse Zhang (c) 2025 所有。
