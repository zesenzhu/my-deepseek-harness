# 04. Super-Agent：Router-Worker 多智能体架构

## 1. 为什么需要多智能体（Multi-Agent）？

在面对复杂软件工程任务时（例如：重构一个拥有数百个文件的仓库、定位跨模块并发死锁、实现一个完整微服务功能）：
- **单 Agent 的局限**：
  1. 上下文过载：阅读太多无关代码会导致关键逻辑被冲淡（Attention Degradation）；
  2. 角色混乱：同一个 Agent 既要负责宏观架构决策，又要细抠某个正则边界条件，极易顾此失彼；
  3. 无法并行：串行执行大大拉长任务交付时间。

DeepSeek 开源的 **Super-Agent 原型 (`dsh-superagent-prototype`)** 采用了行业领先的 **Router-Worker** 拓扑范式。

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

各 Agent 之间通过轻量统一的 **JSON Task Contract** 进行通信：

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

