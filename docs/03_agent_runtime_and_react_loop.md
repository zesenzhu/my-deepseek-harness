# 03. Agent 运行时与自愈型 ReAct 循环

🟡 **本篇可信度：类比为主** —— ReAct 是通用范式而非 DSH 组件；真实对应物是 dsh-agent-loop / dsh-repeat-tool-reminder。

> 📌 **术语澄清**：ReAct 是通用 Agent 范式（Yao et al., 2022），**不是 DSH 的组件**。
> 在发行版产物里搜索 `ReAct` 命中 0 次；DSH 中执行同一职责的包叫 `@deepseek-ai/dsh-agent-loop`，
> 它负责"模型请求 → 流式响应 → 工具执行 → 会话持久化"，并把"取消、并发、工具日志"交给执行器。
> 本篇讲的是**这一类循环的共同结构**，本项目按它实现了一份最小版。

## 1. 传统 ReAct 与 DeepSeek Harness 运行时对比

传统的 ReAct（Reasoning + Acting）模式由 Yao 等人在 2022 年提出，其核心公式为：
`Thought -> Action -> Observation -> Thought ... -> Finish`

在文本对话型框架中，如果一次 Action 抛出异常（例如：`FileNotFoundError`），Agent 往往直接中断或陷入死循环。

而在 **DeepSeek Harness** 中，ReAct 循环被升级为具有**自我纠错与环境自愈能力（Self-Healing）**的工业级状态机：

```
       +-------------------------------------------------+
       |                  User Objective                 |
       +-------------------------------------------------+
                                |
                                v
                +---> [1. Model Step: Thought]
                |               |
                |               v
                |     [2. Decide: Finish or Tool?]
                |        /                     \
       (Goal Reached)   /                       \  (Call Tool)
              v        v                         v
         [Finish & Return]                [3. Guardrail Check]
                                                 |
                                     (Passed)    v    (Blocked by Policy)
                                      [4. Execute in Sandbox] ---> [Feedback Error]
                                                 |                      |
                                                 v                      v
                                      [5. Record Observation (Success or Fail)]
                                                 |
                                                 +----------------------+
```

---

## 2. 状态机核心步进逻辑（Step Phase）

在 DSH 的执行循环中，每个回合细分为四个精细阶段：

### Phase 1: Context Assembly（上下文组装）
- 将当前的系统指令（System Prompt）、可用工具元数据（Tool Schemas）、历史事件轨迹（Trajectory）格式化为适合 DeepSeek 模型的上下文窗口。
- 动态剪裁：当上下文长度逼近上下文阈值时，触发自动压缩插件（Summarization Plugin）。

### Phase 2: Inference & Parse（模型推断与结构化解析）
- 调用模型适配器，生成结构化输出（Thought 推理链 + Tool Call 意图）。
- 在 DeepSeek-R1 / V3 模型中，天然支持 `<think>` 标签与标准 JSON 格式的 Tool Calls。

### Phase 3: Guardrail & Sandbox Execution（安全防线与沙箱执行）
- **白名单校验**：防止 `rm -rf /` 或越权读取敏感密钥等危险行为。
- **沙箱隔离**：在指定工作空间内执行。
- **超时截断**：单个 Bash 命令如果挂起超过配置时间（如 30s），主动发送 SIGKILL 并将超时信息返回给模型。

### Phase 4: Observation Ingestion & Self-Correction（观测注入与自愈）
- 即使命令执行报错（Exit Code != 0 或抛出异常），Harness **绝不会终止流程**！
- 报错信息、stderr 输出以及堆栈信息将被包装为 `tool_result` 反馈给模型。
- 模型在下一步的 `Thought` 中读取到错误，自主调整方案并重新发起修复（例如：缺少依赖则执行 `npm install`，路径错误则重新搜索目录）。

---

## 3. 熔断与终止条件（Termination Guards）

为了避免无限循环消耗 Token，需要多重终止卫士。真实 DSH 里对应的是这些包：

| 卫士 | 真实包 | 行为 |
|---|---|---|
| 重复调用 | `dsh-repeat-tool-reminder` | **先提醒模型换策略**，而不是立刻杀掉 |
| 超时 | `dsh-timeout` / `dsh-tool-call-timeout-policy` | 单次工具调用超时 |
| Token 计量 | `dsh-token-meter` | 统计与限额 |
| 输出过大 | `dsh-spill` / `-policy` | 大输出溢写到文件，避免撑爆上下文 |
| 显式结束 | `dsh-agent-loop` | 模型不再发起工具调用即视为结束 |

本项目的 `ReActLoopPlugin` 实现了其中两件：**渐进式重复提醒 + 熔断**（默认连续 3 次相同调用才中断，
第 2 次先注入 `[Harness Reminder]` 提醒模型换策略）和**最大步数**。

