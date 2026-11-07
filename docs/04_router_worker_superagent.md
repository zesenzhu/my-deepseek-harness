# 04. Router-Worker：多智能体协作的**教学原型**

🟡 **本篇可信度：教学类比** —— Router-Worker 是本项目自建的教学拓扑，DSH 中没有这个名词与对应包。

> 🚨 **重要勘误（必读）**
>
> 本文旧版声称 "DeepSeek 开源的 Super-Agent 原型 (`dsh-superagent-prototype`) 采用了 Router-Worker 拓扑"。
> **这个包不存在，这个拓扑也不是 DSH 的官方设计。** 在真实发行版产物里：
> - `router-worker` 命中 **0** 次
> - `super-agent` 命中 **0** 次
>
> 真实的对应能力是：`dsh-subagent`（子 agent 委派）、`dsh-tool-subagent`（把子 agent 当工具）、
> `dsh-workflow`（脚本化编排）、`dsh-experimental-agent-team`（团队协作，实验性）。
>
> 本篇保留，是因为"角色分工 + 反馈闭环"本身是很好的教学素材，但请把它当作**类比模型**，
> 不要当成 DSH 的架构事实。真实架构见 [00_real_dsh_map.md](00_real_dsh_map.md)。

## 1. 为什么需要多智能体（Multi-Agent）？

在面对复杂软件工程任务时（例如：重构一个拥有数百个文件的仓库、定位跨模块并发死锁、实现一个完整微服务功能）：
- **单 Agent 的局限**：
  1. 上下文过载：阅读太多无关代码会导致关键逻辑被冲淡（Attention Degradation）；
  2. 角色混乱：同一个 Agent 既要负责宏观架构决策，又要细抠某个正则边界条件，极易顾此失彼；
  3. 无法并行：串行执行大大拉长任务交付时间。

本项目用一个 **Router-Worker 拓扑的教学原型** 来演示这种分工（它**不是** DSH 的组件）。

---

## 2. Router-Worker 架构拓扑

```
                            +-----------------------+
                            |     User Objective    |
                            +-----------------------+
                                        |
                                        v
                            +-----------------------+
                            |     Router Agent      |
                            | (Architect / Director)|
                            +-----------------------+
                             /          |          \
           Task 1: Recon    /   Task 2: |    Task 3:\   Task 4: Verify
                           /            |            \
                          v             v             v
                  +-------------+ +------------+ +------------+
                  |  Explorer   | |   Coder    | |   Tester   |
                  |   Worker    | |   Worker   | |   Worker   |
                  +-------------+ +------------+ +------------+
                         \              |              /
                          \             |             /
                           +------------+------------+
                                        |
                                        v
                            +-----------------------+
                            |  Synthesis & Delivery |
                            +-----------------------+
```

---

## 3. 角色分工与职责定义

### 1. Router Agent（主控路由架构师）
- **核心职能**：任务拆解、依赖调度、结果验收。
- **权限与工具**：拥有 `dispatch_subtask` 工具，负责向各类 Worker 派发结构化指令；不直接执行低层次的文件修改命令。
- **状态维护**：维护全局任务清单（Task Board），跟踪哪些步骤完成、哪些失败需重试。

### 2. Explorer Worker（代码库勘测专员）
- **核心职能**：静态分析、符号搜索、依赖图谱构建。
- **权限与工具**：只读工具集（`search_files`、`read_file`、`list_directory`、`find_symbols`）。
- **产出**：输出高密度的代码摘要与精准文件定位，极大节约后续 Coder 的上下文。

### 3. Coder Worker（精准编码攻坚员）
- **核心职能**：根据 Explorer 的定位和 Router 的需求，执行代码补丁编写与精确替换。
- **权限与工具**：读写工具集（`read_file`、`write_file`、`patch_diff`）。
- **特点**：拥有严苛的代码风格规范，关注边界条件与异常处理。

### 4. Tester Worker（质量与沙箱测试员）
- **核心职能**：编写单元测试用例、在隔离沙箱中执行构建与测试脚本。
- **权限与工具**：沙箱终端（`run_bash_command`、`run_tests`）。
- **反馈闭环**：测试通过则向 Router 汇报成功；测试失败则将失败堆栈转化为“Bug 报告”转给 Coder 重新修复。

---

## 4. 协作协议（Protocol）

本教学原型里，各角色之间用一份 **JSON Task Contract** 传递指令（这也是本项目自定的约定，不是 DSH 的协议）：

```json
{
  "task_id": "subtask-102",
  "worker_type": "coder",
  "instruction": "Fix the off-by-one bug in src/utils/pagination.ts",
  "context_hints": [
    "Identified line 42: const totalPages = Math.floor(total / pageSize);",
    "Needs to be Math.ceil(total / pageSize)"
  ],
  "expected_output": "Updated file with unified test case"
}
```

这种规范保证了各智能体之间的高效隔离与纯净通信。

