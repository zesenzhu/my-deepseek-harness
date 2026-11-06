# 01. DeepSeek Harness 架构全景与核心概念

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

### 3.3 Super-Agent 原型
在处理超大规模复杂任务时，单一 Agent 会因上下文窗口爆炸而失焦。DeepSeek Harness 提出了 **Router-Worker** 原型：
- **Router Agent**：负责需求理解、任务拆解与全局调度，不亲自做脏活；
- **Explorer Worker**：快速扫读代码库，构建依赖拓扑与索引；
- **Coder Worker**：针对具体子模块编写修改代码；
- **Tester Worker**：在沙箱中运行测试并反馈错误信息。

