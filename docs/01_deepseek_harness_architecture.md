# 01. DeepSeek Harness 架构全景与核心概念

🟡 **本篇可信度：类比为主** —— 本篇讲通用架构概念，方法名与真实 DSH 基本一致；但 Router-Worker 等归类是本项目自建的类比。

> ⚠️ **先读 [00_real_dsh_map.md](00_real_dsh_map.md)**。本篇是"概念地图"，其中部分类比（如 Router-Worker）
> **不是 DSH 的真实组件**，必须先分清哪些是真实架构、哪些是本项目的教学建模。

## 1. 什么是 DeepSeek Harness (dsh)？

**DeepSeek Harness (简称 dsh)** 是 DeepSeek AI 官方开源的自主智能体（Autonomous Agent）运行时与实验控制框架。

在英文中，**Harness** 的字面意思是“马具、挽具”或“测试台架”。在系统工程中，Harness 扮演着将强大但无序的原始动力（LLM 模型）约束、引导并安全连接到执行机械（终端、文件系统、工具链）的**控制底盘与装配架**。

如果把大语言模型（如 DeepSeek-V3 / DeepSeek-R1）比作一台**发动机（Engine）**，那么：
- 传统的 ChatBot 只是把发动机接上了一个仪表盘和喇叭；
- 而 **DeepSeek Harness** 则为这台发动机装配了底盘、传动轴、转向机、传感器和防护外壳——将其变成了一台能够在真实软件工程环境中自主越野的**全自主特种载具**。

```
+-------------------------------------------------------------------+
|                     DeepSeek Harness (dsh)                        |
|                                                                   |
|   +-----------------------------------------------------------+   |
|   |                  Cordis 微内核插件树 (Context)             |   |
|   +-----------------------------------------------------------+   |
|         |                     |                     |             |
|         v                     v                     v             |
|  [Model Adapters]     [Agent Loops]        [Tool Registries]      |
|  - DeepSeek API       - ReAct Loop         - Terminal Runner      |
|  - OpenAI Compatible  - Router-Worker      - File System Tool     |
|  - Local LLM          - Plan-Solve Loop    - Git & Code Search    |
|         |                     |                     |             |
|         +---------------------+---------------------+             |
|                               |                                   |
|                               v                                   |
|   +-----------------------------------------------------------+   |
|   |         Session & Event Store (Event Sourced Trajectory)  |   |
|   +-----------------------------------------------------------+   |
|                               |                                   |
|                               v                                   |
|   +-----------------------------------------------------------+   |
|   |         Sandboxed Execution Environment (Workspace)       |   |
|   +-----------------------------------------------------------+   |
+-------------------------------------------------------------------+
```

---

## 2. 为什么需要 DeepSeek Harness？

传统的 Agent 框架（如早期的 LangChain Agent、AutoGPT 等）通常存在以下痛点：

1. **核心逻辑硬编码**：Agent 的推导循环（ReAct Loop）通常固定在类库深处，想修改思考步骤或插入安全策略非常困难。
2. **缺乏状态可重放性（Replayability）**：当 Agent 经历了十几步调用出现逻辑偏差时，无法精确回溯是哪一步输入或工具输出导致了幻觉。
3. **环境与控制耦合严重**：工具执行与模型提示词纠缠在一起，难以跨平台（Web UI、Headless CLI、CI/CD 自动化）无缝迁移。

DeepSeek Harness 针对上述问题，给出了颠覆性的架构解法：
- **解耦推理与控制（Separation of Planning and Control）**：LLM 专注于高阶规划与代码编写；Harness 负责控制循环、工具调用白名单、超时熔断与沙箱防护。
- **时空可组合性（Spatiotemporal Composability）**：基于 **Cordis** 元框架，组件生命周期清晰，插件加载与卸载不会残留脏状态。
- **一切皆插件（Everything is a Plugin）**：模型是插件、工具是插件、执行循环是插件、甚至会话持久化也是插件！

---

## 3. 核心设计支柱

### 3.1 任务导向的运行时（Task-Oriented Runtime）
普通的聊天交互是“一问一答”的被动请求；而 DSH 接收的是**目标（Objective）**。例如：
> *"修复 src/auth.ts 中 JWT 过期校验未抛出 401 状态码的 Bug，并运行测试确保通过。"*

Harness 会自主拆解任务、通过文件工具读取代码、利用终端工具运行测试、解析报错回溯、修改代码并二次验证，直到达成目标或触发熔断。

### 3.2 事件溯源 Trajectory
DSH 的整个会话生命周期是一个**不可变追加事件流（Append-Only Event Log）**。
每一个用户指令、模型思考（Thought）、工具调用参数（Tool Call）、环境观察（Observation）都被记录为独立事件。这赋予了系统强大的调试、会话分支（Branching）和回放（Replay）能力。

### 3.3 多 Agent 协作（教学类比：Router-Worker）

> 📌 **勘误**：DSH 里**没有** "Router-Worker" 这个拓扑，也没有 `dsh-superagent-prototype` 这个包
> （在发行版产物里搜索 `router-worker` / `super-agent` 命中数为 0）。
> 下面是本项目为讲解"角色分工 + 反馈闭环"而自建的类比模型。

- **Router Agent**：负责任务拆解与全局调度（对应我们 demo 里的 `router-worker-loop`）
- **Explorer Worker**：只读勘测、代码定位
- **Coder Worker**：编写修改
- **Tester Worker**：跑测试并回传真实结果

真实 DSH 中相近的能力由这些包提供：

| 真实包 | 能力 |
|---|---|
| `@deepseek-ai/dsh-subagent` | 子 agent 委派：本地 spawn/fork 保留持久会话；ACP / DSH SDK / Codex / Claude Code 为一次性执行 |
| `@deepseek-ai/dsh-tool-subagent` | 让模型把子 agent 当工具调用 |
| `@deepseek-ai/dsh-workflow` / `-ptc` | 脚本化多 agent 编排 |
| `@deepseek-ai/dsh-experimental-agent-team` | 团队式协作（实验性） |

### 3.4 本篇没提到、但真实 DSH 很关键的部分

- **profile / bundle / patch 分层装配**：`web` / `headless` / `sdk` / `sdk-minimal` / `acp` 五种 profile，`dsh-base` 是第一层组合包，`cordis.patch.yml` 按 id 打补丁
- **工具策略**：`dsh-tools` 的 allow / deny / ask 三态
- **进程沙箱**：`dsh-sandbox` 的 `read-only` / `workspace-write` / `danger-full-access`，无法强制则失败关闭
- **上下文压缩**：`dsh-compaction`（被遮蔽内容仍留在日志中，保证回放一致）
- **会话格式版本化**：`dsh-session-format` 带 `v0→v4` 迁移链
- **审批、后台作业、输出溢写、技能**：`dsh-user-approval` / `dsh-jobs` / `dsh-spill` / `dsh-skill`

详见 [00_real_dsh_map.md](00_real_dsh_map.md)。

