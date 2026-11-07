# 00. 真实 DSH 对照表与勘误（先读这篇）

> 这份文档是本项目在 2026-11 做的一次"事实核对"结果。
> 之前 01~06 篇里有若干把**教学类比**说成**真实 DSH 组件**的地方，本文逐条纠正，
> 并给出"去哪里自己验证"的方法。

---

## 1. 本项目到底是什么

**一句话**：这是一个**用 1000 多行代码复刻 Agent Harness 关键机制的教具**，不是 DSH 源码，也不是 DSH 的官方简化版。

| 是 | 不是 |
|---|---|
| 教学用的最小实现（Context / 策略 / 工具 / 循环 / 会话 / Web 推流） | DSH 的源码镜像 |
| 借用了 Cordis 的**思想**（插件 + 服务 + 可撤销副作用） | Cordis 本身（真实 DSH 直接依赖 `@deepseek-ai/cordis@4.1.0`） |
| 用"Router-Worker"角色分工**类比**多 Agent 协作 | DSH 的官方拓扑（DSH 里没有这个名词） |
| 真实的文件系统、真实的子进程、真实的失败 | 真实的模型推理（示例 1~4 的模型是剧本回放，示例 5 的决策是脚本） |

判断标准很简单：**想学"DSH 怎么设计"，看真实仓库和本文第 3、4 节；想学"我自己怎么写出一个 harness"，看本项目的代码。**

---

## 2. 已修正的错误清单

| # | 原来的说法 | 真实情况 | 现在的处理 |
|---|---|---|---|
| 1 | 守卫用 `ctx.on('tool:before_call', () => { throw })` 来拦截 | 事件派发是**通知**语义，异常会被吞掉；`../escape.txt` 能写到工作区外、`rm -rf /` 能真的进 shell（已实测） | 改为 **PolicyEngine 裁决管线**（allow/deny/ask + 失败关闭），`ToolRegistry.execute` 在执行前强制裁决；[sandbox-guard.ts](../src/plugins/guardrails/sandbox-guard.ts) 重写 |
| 2 | `dsh-superagent-prototype` 是 DeepSeek 开源的 Super-Agent 原型 | **不存在这个包**。发行版里 `router-worker`、`super-agent` 命中 0 次 | 文档改为"教学原型"，并标注真实对应物（`dsh-subagent` / `dsh-tool-subagent` / `dsh-workflow` / `dsh-experimental-agent-team`） |
| 3 | "ReAct Loop 是 DSH 的执行循环" | 产物里 `ReAct` 命中 0 次。真实是 `@deepseek-ai/dsh-agent-loop` | 循环实现保留（ReAct 是通用范式），但文档明确写"这不是 DSH 的组件名" |
| 4 | 工具是"沙箱内真实执行测试" | 旧 `bash_run` 用 `authCode.includes('now > exp')` **伪造** Jest 报告，且不启动任何进程 | 改为在 `node:vm` 里**真实执行** `verifyToken` 跑 3 条断言；输出带 `[SIMULATED RUNTIME]` 前缀 |
| 5 | Mock 模型能"自主排错" | 旧 mock 是写死的 5 回合剧本，第 3 回合把"修复后的代码"整段硬编码写入 | 改名为 **Scripted Fixture**，所有输出加 `[SCRIPTED]` 前缀；另加 `examples/05` 做"脚本化决策 + 真实效果"的对照 |
| 6 | `workspace/` 是"带真实 Bug 的工作区" | 之前跑完示例后工作区已被改成修复版，永远显示绿灯 | 新增 `workspace/src/calculator.buggy.js` 基线 + `npm run reset`；superagent 检测到"本来就绿"会直接提示复位 |
| 7 | Router-Worker 演示"100% 通过" | 旧实现无论测试结果如何都 `success: true`，并打印写死的 "100% pass rate" | 结果全部取自工具返回值；失败会如实返回 `success: false` |
| 8 | 示例 2 的"防篡改守卫"能拦截 | 拦的是 `package.json`/`.env`，但剧本只写 `src/auth.js`，所以**从未触发过**；即使触发也会被吞 | 示例 2 重写：先跑正常流程，再显式发起越权写入，并断言 `package.json` 未被篡改 |
| 9 | `.env` 可以提交 | 仓库里 `.env` 曾被 git 跟踪且含真实 API Key | 已加 `.gitignore` 并 `git rm --cached .env`；**若你曾经 push 过，请立刻轮换 Key** |
| 10 | `npm run build` 可用 | `tsc` 有 24 个错误 | 已修复，`npm run typecheck` / `npm run build` 全绿，并加了 15 个测试 |

---

## 3. 真实 DSH 事实卡（可自行验证）

### 3.1 基本事实

- 仓库：<https://github.com/deepseek-ai/deepseek-harness>（公开，TypeScript，描述就是 **"DeepSeek Harness: Everything is a Plugin."**）
- 文档站：<https://deepseek-harness.github.io/deepseek-harness/>
- 底层框架：[Cordis](https://github.com/cordiverse/cordis)，对应设计论文 *A Programming Paradigm for Spatiotemporal Composability*
- 形态：`npx @deepseek-ai/dsh web` 启动 Web UI（默认 `127.0.0.1:3080`），Electron 桌面版内置**精确同版本**的生产运行时

### 3.2 规模（比本项目大 3 个数量级）

| 维度 | 数量 | 说明 |
|---|---|---|
| 发行版依赖的 `@deepseek-ai/*` 包 | **329** | 桌面运行时 `package.json` 里的 dependencies |
| 仓库 `packages/` 顶层分组 | **59** | `core / llm / tools / session / sandbox / compaction / subagent / skill / jobs / goal / workflow / ptc-runtime / typert / mcp / acp / sdk / web / team / …` |
| `docs/` 下的文档 | **83** 个条目（含 `.zh.md` 双语） | `architecture.zh.md`、`cordis-primer.zh.md`、`agent-lifecycle.zh.md`、`config-catalog.zh.md`… |

### 3.3 核心 ctx 键（来自官方 `docs/architecture.zh.md`）

| 包 | 职责 | ctx 键 |
|---|---|---|
| `core/session` | 仅追加的 `SessionEvent` 日志与内存存储 | `ctx.sessions` |
| `core/system-prompt` | 提示词片段与工具 schema 组装 | `ctx.systemPrompt` |
| `core/tools` | 作用域化工具注册表 + 带把关的执行流水线 | `ctx.tools` |
| `core/agent` | `Agent` 接口、活跃 agent 注册表、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 默认驱动器（模型请求 → 流式 → 工具 → 持久化） | `ctx.agentLoop` |
| `llm/llm` | 消息/流式词汇表与适配器 seam | `ctx.llm` |
| `core/scope` | 按 agent 划分作用域的注册原语 | 库，无 ctx 键 |

### 3.4 组装模型：profile / bundle / patch（本项目完全没有，但很关键）

- **profile**：Harness home 里的具名组装，随发行版提供 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`
- **bundle（组合包）**：Cordis 配置项 + 挂载代码的分发格式，`dsh-base` 是 `web`/`headless`/`sdk`/`acp` 共享的第一层
- **patch**：`cordis.patch.yml` 按 id 定位条目替换其整个 config
- 自检命令：`dsh --profile web --dump-config` —— **你机器上就有一棵真实的插件树，比任何二手文档都可靠**

### 3.5 几个"本项目缺失但很重要"的机制

| 机制 | 真实包 | 一句话 |
|---|---|---|
| 工具策略 | `dsh-tools` | allow / deny / ask 三态；`defineTool` 声明类型化参数、超时、并行安全 |
| 进程沙箱 | `dsh-sandbox` | `read-only` / `workspace-write` / `danger-full-access`；无法强制就 `SANDBOX_UNAVAILABLE` 失败关闭；被拒后可申请一次升权给人批 |
| 上下文压缩 | `dsh-compaction` + `-basic` / `-image-offload` / `-tool-result-pruner` | 把早期历史压成摘要，被遮蔽内容仍留在日志里以保证回放一致 |
| 会话格式 | `dsh-session-format` + `v0→v1→v2→v3→v4` 迁移包 | 日志格式有版本号和迁移链 |
| 子 agent | `dsh-subagent` + `spawn/fork-in-process` + `tool-subagent` | spawn/fork 保留持久会话可续聊；ACP/SDK/Codex/ClaudeCode 为一次性执行 |
| 审批 | `dsh-user-approval` + `dsh-permission-presets` | 人机确认是独立服务，不是塞在 guard 里 |
| 后台作业 | `dsh-jobs` + `-local` + `tool-jobs` | 长任务可后台跑 |
| 输出落盘 | `dsh-spill` + `-policy` + `-local` | 大输出溢写到文件，避免撑爆上下文 |
| 技能 | `dsh-skill` + `-filesystem` + `tool-skill` + `skill-office` | 按需加载的技能包（你正在用的 office/xlsx 就是这一类） |
| 编排 | `dsh-workflow` / `-ptc` / `team` | 多 agent 脚本化编排 |

---

## 4. 包族 → 本项目对应实现

| 真实 DSH | 本项目 | 差距 |
|---|---|---|
| `@deepseek-ai/cordis` | `src/core/context.ts` | 手写 120 行；无 Service 基类 / 作用域 / inject |
| `dsh-tools` | `src/core/registry.ts` + `src/core/policy.ts` | 有 allow/deny/ask，无 `defineTool` 类型推导、无并行执行器 |
| `dsh-sandbox` | `src/plugins/guardrails/sandbox-guard.ts` | 只有路径 jail + 命令白名单，**没有真正的进程隔离** |
| `dsh-agent-loop` | `src/plugins/loops/react-loop.ts` | 无流式、无 token 计量、无压缩触发 |
| `dsh-session` | `src/core/session.ts` | 内存版；无 JSONL 持久化、无 projection、无版本迁移 |
| `dsh-user-approval` | `PolicyEngine` 的 `approvalHandler` | 只有回调，没有真正的 UI 交互链路 |
| `dsh-subagent` | `src/plugins/loops/router-worker-loop.ts`（类比） | 同一个进程内顺序执行，没有真正的子 agent 会话 |
| `dsh-compaction` | — | 未实现（文本超长就会直接截断） |
| `dsh-web` / `-frontend` | `src/plugins/web/*` | 原生 SSE 小看板，非 React 插件化前端 |

---

## 5. 想深入真实 DSH 时，按这个顺序读

1. `docs/cordis-primer.zh.md` → `docs/cordis-tutorial/`：先搞懂 Cordis 的服务/作用域/可撤销副作用
2. `docs/architecture.zh.md`：profile / bundle / patch 的分层装配，核心包的 ctx 键
3. `docs/agent-lifecycle.zh.md`：一次 agent 运行从创建到恢复的完整生命周期
4. `packages/core/*`、`packages/llm/*` 的 `README.zh.md`（每个包都有中英双语 README，直接读源码前先读它）
5. `docs/config-catalog.zh.md`：所有插件的配置字段（自动生成，不会过期）
6. `dsh --profile web --dump-config`：把上面所有概念落到你本机真实的那棵树上

> 小技巧：桌面版把运行时打包在 `app.asar` 里，其中的 `node_modules/@deepseek-ai/*/README.zh.md` 就是随版本发行的文档，离线也能读。

---

## 6. 本项目的"诚实边界"

以下几件事本项目**不做**，也不假装做：

- ❌ 不提供真实进程隔离（路径 jail 只挡越界路径，挡不住 `node -e "..."` 的恶意逻辑）
- ❌ 不做 token 计量与成本控制
- ❌ 不做上下文压缩，长任务会撞上下文上限
- ❌ 不做会话持久化（关掉进程事件就没了）
- ❌ 示例 1~4 的模型是剧本回放；示例 5 的决策是脚本

如果你的目标是在生产里跑 Agent，用真实 DSH，而不是这个项目。
如果你的目标是**看懂 harness 为什么长这样**，这个项目刚好够用。
