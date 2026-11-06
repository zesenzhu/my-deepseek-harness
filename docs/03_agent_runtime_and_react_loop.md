# 03. Agent 运行时与自愈型 ReAct 循环

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

为了避免无限循环消耗 Token，DSH 引入了多重终止卫士：
1. **Max Steps Guard**：单次任务的最大步数限制（例如 20 步）。
2. **Repetition Guard**：检测模型是否连续发出完全相同的 Tool Call 参数（死锁检测）。
3. **Budget/Token Guard**：累计消耗的 Token 数量或费用上限。
4. **Explicit Finish**：模型显式输出结束指令并提交最终交付物。

