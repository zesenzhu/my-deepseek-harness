# 05. 会话持久化与事件溯源（Event Sourcing）

## 1. 为什么采用事件溯源（Event Sourcing）？

传统的应用通常保存“当前状态”（State Mutation），例如数据库只存 `status = "completed"`。但对自主智能体（Autonomous Agent）而言，如果只保存最终状态，我们将失去：
1. **诊断线索**：无法复盘模型在第 7 步为什么做出了错误的工具调用；
2. **时空分支能力**：无法从第 5 步“分叉”（Fork）出一条新分支尝试不同的提示词或方案；
3. **断点恢复（Resume）**：如果长达一小时的任务在第 30 步因网络抖动中断，无法零成本恢复。

**DeepSeek Harness 全面拥抱事件溯源（Event Sourcing）机制**：
> **状态只是事件流的折叠投影（State = fold(Events)）。**

---

## 2. 事件生命周期数据模型（Event Schema）

每一条进入 Session 的事件都是不可变对象（Immutable Record）：

```typescript
export interface TrajectoryEvent {
  id: string;               // 唯一事件 ID (如 evt_1710001)
  timestamp: number;        // 时间戳
  type: 
    | 'USER_PROMPT'         // 用户下达的初始指令
    | 'AGENT_THOUGHT'       // 模型的内在思考过程 (CoT / <think>)
    | 'TOOL_CALL'           // 准备调用的工具与参数
    | 'TOOL_RESULT'         // 工具在沙箱中返回的执行结果或错误
    | 'SYSTEM_GUARDRAIL'    // 安全护栏拦截警告
    | 'TASK_COMPLETED';     // 任务达成确认
  payload: any;             // 事件内容载荷
  metadata?: {
    stepIndex: number;      // 回合索引
    agentId?: string;       // 派发该事件的智能体 ID
    tokensUsed?: number;    // 本步消耗的 Token
  };
}
```

---

## 3. 核心能力实战

### 3.1 会话回放（Replay）
通过按序遍历事件流，我们可以像“放电影”一样：
- 以慢动作回放模型思考与工具调用；
- 将历史轨迹渲染为富文本、时间线或可视化 Web UI。

### 3.2 会话分叉（Branching / Forking）
当发现模型在第 N 步走入歧途时：
1. 获取 0 到 N-1 步的事件流截断；
2. 追加一条修正后的 Guidance 提示；
3. 衍生出一个新的 Session ID，启动新分支探索。

### 3.3 离线评估与回归测试（Benchmarking Harness）
这也是为什么该框架被称为 **Harness** 的关键所在：
你可以将收集到的高质量开发者真实操作事件流作为 Ground Truth，批量输入不同的 DeepSeek 微调模型，自动化跑评测基准，检验模型的工具使用能力与 Coding 成功率。

