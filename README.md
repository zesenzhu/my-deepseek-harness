# DeepSeek Harness (dsh) 学习项目

一个**约 1500 行**的教学实现，用来拆解 Agent Harness 的关键机制：微内核上下文、插件生命周期、
工具准入策略、ReAct 循环、事件溯源会话、原生 SSE 推流。

> **定位先说清楚**
>
> 这不是 DSH 的源码镜像，也不是官方简化版。真实的
> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是 329 个 `@deepseek-ai/dsh-*` 包、
> 59 个 `packages/` 分组的完整产品（TypeScript + [Cordis](https://github.com/cordiverse/cordis) 驱动，
> 官方描述就是 **"Everything is a Plugin"**）。
>
> 本项目做的是：**用最小代码把"为什么 harness 要长这样"讲明白**。
> 哪部分是真实 DSH、哪部分是教学类比，逐条写在
> **[docs/00_real_dsh_map.md](docs/00_real_dsh_map.md)** —— 请先读它。

---

## 目录结构

```text
deepseek-harness-study/
├── docs/
│   ├── README.md                       # 📖 文档索引：按"可信度"和路线挑着读
│   ├── 00_real_dsh_map.md              # ⭐ 真实 DSH 事实卡 + 勘误 + 包族对照（先读）
│   ├── 01_deepseek_harness_architecture.md
│   ├── 02_everything_is_a_plugin.md
│   ├── 03_agent_runtime_and_react_loop.md
│   ├── 04_router_worker_superagent.md  # 教学类比，非 DSH 官方拓扑
│   ├── 05_session_and_event_sourcing.md
│   ├── 06_fullstack_superagent_deep_dive.md   # 🔴 本项目 demo 解析（非 DSH）
│   ├── 07_real_plugin_tree.md          # ⭐ 解剖你本机真实的插件树（profile/patch/会话日志）
│   └── 08_real_bundle_tree.md          # ⭐ 真实组合包配置树（148 行，官方发行物）
│
├── src/
│   ├── core/
│   │   ├── types.ts          # 全部契约：Tool / Model / Session / Loop / Policy
│   │   ├── context.ts        # Cordis 风格容器（服务 DI + 事件总线 + 插件生命周期）
│   │   ├── policy.ts         # ⭐ 工具准入策略引擎（allow / deny / ask，失败关闭）
│   │   ├── registry.ts       # ⭐ 工具注册表：执行前强制裁决，拒绝则不调用
│   │   ├── config.ts         # 极简配置 schema 校验（fail fast）
│   │   ├── session.ts        # 事件溯源会话（不可变事件 / 回放 / 分叉）
│   │   └── harness.ts        # 主引导：注入 session / policies / tools
│   ├── plugins/
│   │   ├── models/
│   │   │   ├── deepseek-adapter.ts        # 真实 DeepSeek API + 剧本回放（明确标注）
│   │   │   └── scripted-workspace-model.ts# 决策脚本化、效果真实（供示例 5）
│   │   ├── tools/
│   │   │   ├── file-tools.ts      # 内存虚拟文件系统
│   │   │   ├── terminal-tools.ts  # 内存"伪终端"（在 vm 里真实执行 auth.js 逻辑）
│   │   │   └── real-fs-tools.ts   # 真实磁盘 + 真实子进程
│   │   ├── guardrails/sandbox-guard.ts    # 路径 jail + 命令白名单（裁决式）
│   │   ├── loops/{react,router-worker,superagent}-loop.ts
│   │   └── web/                  # 原生 HTTP + SSE 看板
│   ├── web-entry.ts              # Web 控制台装配入口
│   └── index.ts                  # CLI 装配入口
│
├── examples/
│   ├── 00_test_connection.ts     # .env / API 连通性诊断
│   ├── 01_basic_agent.ts         # 基础 ReAct（内存沙箱 + 剧本模型）
│   ├── 02_custom_plugin.ts       # ⭐ 自定义插件：策略拦截 + 事件遥测（带拦截验证）
│   ├── 03_session_replay.ts      # 回放 / 分叉 / 导出
│   ├── 04_router_worker_task.ts  # Router-Worker 教学原型
│   └── 05_real_workspace_agent.ts# ⭐ 真实磁盘 + 真实 `node test.js`：真红 → 真修复 → 真绿
│
├── fixtures/real-dsh/            # 官方组合包配置原件（BSD-3-Clause，可复现）
├── tests/run.ts                  # 15 个用例：策略语义 / 守卫回归 / 会话 / 熔断 / 端到端
├── scripts/
│   ├── reset-workspace.mjs       # 把 demo 工作区复位到"含 Bug 基线"
│   ├── inspect-real-dsh.mjs      # ⭐ 只读探查本机真实安装（profile / patch / 会话格式）
│   ├── fetch-real-bundles.mjs    # 拉取真实组合包配置到 fixtures/
│   └── analyze-bundle-tree.mjs   # ⭐ 分析真实配置树（三种 patch 动作 / 领域分布）
├── workspace/                    # 真实演练工作区
│   ├── src/calculator.js         # 会被 Agent 真实修改
│   ├── src/calculator.buggy.js   # 含 Bug 的基线（复位源）
│   └── test.js                   # 真实断言（node 原生）
└── python_version/mini_dsh.py    # Python 对照实现
```

---

## 快速上手

```bash
npm install            # 或 pnpm install

cp .env.example .env   # 可选：不填 Key 会自动进入"剧本回放"模式
npm test               # 15 个用例，应当全绿
```

### 命令一览

| 命令 | 说明 |
|---|---|
| `npm test` | 测试套件（策略语义、守卫回归、会话、死循环熔断、端到端） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | 编译到 `dist/` |
| `npm run reset` | 把 `workspace/src/calculator.js` 复位成含 Bug 的基线 |
| `npm run inspect` | 只读探查你本机真实的 DSH 安装（`--patch` / `--sessions`） |
| `npm run analyze` | 分析官方组合包配置树（148 行、三种 patch 动作、领域分布） |
| `npm run fetch:real` | 重新拉取 `fixtures/real-dsh/` 里的官方配置快照 |
| `npm run example:real` | **推荐**：真实磁盘 + 真实子进程的完整闭环 |
| `npm run example:basic` | 基础 ReAct（内存沙箱） |
| `npm run example:plugin` | 自定义插件：策略拦截演示（会验证拦截真的生效） |
| `npm run example:replay` | 会话回放 / 分叉 / 导出 |
| `npm run example:router-worker` | Router-Worker 教学原型 |
| `npm run web` | Web 看板（默认 <http://localhost:3000>） |
| `npm run start` | CLI 入口 |
| `python3 python_version/mini_dsh.py` | Python 对照版 |

> Web 看板里的协同演示需要工作区**存在 Bug**。如果它提示"测试一开始就是绿的"，
> 先跑 `npm run reset`。

---

## 两种模式：别搞混

| 模式 | 命令 | 模型 | 工具 | 测试结果来自 |
|---|---|---|---|---|
| 剧本回放 | `EXECUTION_MODE=mock` | 写死的 5 回合（输出带 `[SCRIPTED]`） | 内存虚拟文件系统 | `node:vm` 里真实执行 `verifyToken` |
| 真实模型 | `EXECUTION_MODE=live` + Key | 真 DeepSeek API | 内存虚拟文件系统 | 同上 |
| 真实工作区 | `npm run example:real` | 决策脚本（`[SCRIPTED]`） | 真实磁盘 + 真实子进程 | 真实 `node test.js` 退出码 |

**为什么保留"剧本模型"？** 它让你在没有 Key 的情况下也能把"循环 + 工具 + 策略 + 事件"这条
工程链路跑通。但它不是模型能力，所以所有输出都打了 `[SCRIPTED]`。
想观察真实行为差异，看示例 5 或切到 live。

---

## 一个值得记住的教训：拦截不能用 `throw`

早期版本的沙箱守卫是这样写的：

```ts
ctx.on('tool:before_call', () => { throw new Error('Access denied') }) // ❌ 看起来对，实际全线失效
```

但 `emit` 为了避免一个监听器拖垮整条链路，会**吞掉**异常。结果实测：

```
../escape-proof.txt  → 成功写到工作区外
rm -rf /             → 真的进了 shell
```

修复方式是把它变成**裁决管线**（真实 DSH 的 `dsh-tools` / `dsh-sandbox` 同样如此）：

```ts
ctx.get('policies').use({ name: 'sandbox/path-jail', check: (call) => ({ decision: 'deny', reason: '...' }) })
```

`ToolRegistry.execute` 会在调用工具**之前**跑裁决：`deny` 直接返回失败结果，工具根本不会被执行。
`ask` 在没有审批器时**失败关闭**（绝不放行）。

这条教训现在有回归测试守护（`tests/run.ts` 第 3 组）。

---

## 推荐学习顺序

0. **[docs/README.md](docs/README.md)** —— 文档索引（按可信度与学习路线挑）
1. **[docs/00_real_dsh_map.md](docs/00_real_dsh_map.md)** —— 先建立"哪些是真的、哪些是类比"的坐标系
2. [docs/01](docs/01_deepseek_harness_architecture.md) → [docs/02](docs/02_everything_is_a_plugin.md)：架构总览与插件/服务
3. 读 `src/core/context.ts` + `src/core/registry.ts` + `src/core/policy.ts`：**上下文、注册表、策略**这三件套
4. 跑 `npm run example:real`：看一次"真红 → 真修复 → 真绿"的闭环
5. [docs/03](docs/03_agent_runtime_and_react_loop.md) + `src/plugins/loops/react-loop.ts`：循环、自愈、熔断
6. [docs/05](docs/05_session_and_event_sourcing.md) + `npm run example:replay`：事件溯源与回放/分叉
7. [docs/04](docs/04_router_worker_superagent.md)：多角色协作（记得它是类比）
8. 最后读 [docs/06](docs/06_fullstack_superagent_deep_dive.md) 与 `src/plugins/web/`：全栈与 SSE 推流
9. 想啃真实源码：**[docs/07](docs/07_real_plugin_tree.md)** + `npm run inspect` —— 用你自己机器上的 profile/patch/会话日志对照
10. 想看真实配置树：**[docs/08](docs/08_real_bundle_tree.md)** + `npm run analyze` —— 148 行官方配置，三种 patch 动作与权限三档

---

## 本项目不做什么（诚实边界）

- ❌ **没有真实进程隔离**：路径 jail 只挡越界路径，挡不住 `node -e "...恶意逻辑..."`。真隔离需要容器 / microVM，
  或直接用 DSH 的 `dsh-sandbox`（`read-only` / `workspace-write` / `danger-full-access` 三档 + 失败关闭）
- ❌ 没有 token 计量与成本控制（真实：`dsh-token-meter`）
- ❌ 没有上下文压缩（真实：`dsh-compaction`）
- ❌ 没有会话持久化（真实：`dsh-session-persistence-jsonl` + 格式 `v0→v4` 迁移链）
- ❌ 没有真正的子 agent（真实：`dsh-subagent` 的 spawn/fork + 跨 ACP/SDK/Codex/ClaudeCode 后端）
- ❌ 没有 profile / bundle / patch 分层装配（真实：`dsh --profile web --dump-config` 可导出本机真实插件树）

---

## 安全提示

`.env` 现在已被 `.gitignore` 忽略，并从 git 索引中移除。
**如果你之前已经把含真实 Key 的提交推送到过远端，请立刻去服务商轮换该 Key。**

---

## 许可

本仓库包含**两种许可**的内容，别混用：

| 范围 | 许可 |
|---|---|
| 本项目自身的代码与文档（`src/`、`examples/`、`tests/`、`scripts/`、`docs/` 等） | **MIT** |
| `fixtures/real-dsh/` 下的 3 个官方配置副本 | **BSD 3-Clause**（`Copyright (c) 2026, DeepSeek`） |

完整许可文本（含 BSD 全文、第三方说明与商标声明）见仓库根的 [LICENSE](LICENSE)。

> 本项目是独立的第三方学习项目，与 DeepSeek AI 无隶属、无赞助、无背书关系。
> "DeepSeek"、"DeepSeek Harness"、"dsh"、"Cordis" 等名称归其各自权利人所有。
