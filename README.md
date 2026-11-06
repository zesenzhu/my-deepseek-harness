# DeepSeek Harness (DSH) 学习与实战研习项目

欢迎来到 **DeepSeek Harness (dsh)** 核心架构与实战学习项目！

本项目针对 DeepSeek 官方开源的 Agent 运行环境与框架 **`deepseek-ai/deepseek-harness`** 进行深度解构与全真实现。无论你是想探究现代前沿 AI Agent Runtime 的底层原理，还是希望掌握自主智能体（Autonomous Coding Agent）的设计模式，本项目都为你提供了从“架构原理剖析”到“可执行源码实战”的一站式学习路径。

---

## 🌟 核心理念：Everything is a Plugin

DeepSeek Harness 最具革命性的设计在于：**一切皆插件（Everything is a Plugin）**。
传统的 Agent 框架往往将执行循环（Execution Loop）、模型通信、记忆管理深度耦合在主引擎中；而在 DeepSeek Harness 中：
- 🔌 **模型适配器是插件**（DeepSeek、OpenAI、Claude、本地模型均可即插即用）
- 🔄 **智能体循环是插件**（ReAct 循环、Plan-and-Solve 循环、Router-Worker 循环均可热插拔）
- 🛠️ **工具与技能是插件**（文件操作、终端沙箱、Git 控制、代码检索等动态挂载）
- 📜 **会话与记忆是插件**（基于事件溯源 Event Sourcing 的 Trajectory 记录、回放与分支）
- 🛡️ **安全与守卫是插件**（指令过滤、审批断点、权限隔离）

---

## 🗂️ 目录结构导航

```text
deepseek-harness-study/
├── README.md                          # 本项目全景说明
├── package.json                       # 项目依赖与启动脚本
├── tsconfig.json                      # TypeScript 编译配置
├── .env.example                       # 环境变量模板（支持真实 API 或 Mock 模式）
│
├── docs/                              # 📚 深度架构与技术原理文档
│   ├── 01_deepseek_harness_architecture.md # 核心架构总览与 Cordis 设计哲学
│   ├── 02_everything_is_a_plugin.md        # 插件系统与服务注册机制
│   ├── 03_agent_runtime_and_react_loop.md  # Agent 运行时与自愈型 ReAct 循环
│   ├── 04_router_worker_superagent.md      # Super-Agent: Router-Worker 多智能体架构
│   ├── 05_session_and_event_sourcing.md    # 状态持久化、会话分支与轨迹回放 (Replay)
│   └── 06_fullstack_superagent_deep_dive.md # 全栈沙箱、Web推流与Super-Agent深度研学
│
├── workspace/                         # 🔒 受控真实演练工作区 (带真实 Bug 与测试用例)
│   ├── src/calculator.js              # 包含逻辑缺陷的业务代码
│   ├── test.js                        # 自动化测试用例
│   └── package.json
│
├── src/                               # 💻 核心架构源码（轻量高内聚微内核）
│   ├── core/                          # 核心微内核引擎 (Context, Session, Harness)
│   ├── plugins/                       # 标准插件库
│   │   ├── models/                    # 模型适配插件 (Mock + DeepSeek API)
│   │   ├── tools/                     # 工具注册插件 (真实磁盘/Shell + 模拟沙箱)
│   │   ├── guardrails/                # 安全守卫中间件 (Workspace Jail 防穿越)
│   │   ├── loops/                     # 执行循环策略插件 (ReAct + Router-Worker)
│   │   └── web/                       # Web 原生 HTTP + SSE 推流仪表盘
│   ├── web-entry.ts                   # Web 控制台一键装配入口
│   └── index.ts                       # CLI 交互入口
│
├── examples/                          # 🚀 教学范例（可直接运行）
│   ├── 01_basic_agent.ts              # 范例 1: 基础智能体完成单任务
│   ├── 02_custom_plugin.ts            # 范例 2: 开发并热挂载自定义插件
│   ├── 03_session_replay.ts           # 范例 3: 事件轨迹回放与状态审计
│   └── 04_router_worker_task.ts       # 范例 4: Super-Agent 协同解决复杂编程任务
│
└── python_version/                    # 🐍 Python 对照版本
    └── mini_dsh.py                    # 纯原生 Python 实现的轻量单文件对照版
```

---

## ⚡ 快速上手

### 1. 环境准备
本项目基于现代 Node.js (推荐 v18+) 与 TypeScript 开发。
```bash
cd deepseek-harness-study
npm install
```

### 2. 配置环境（可选）
复制 `.env.example` 为 `.env`：
```bash
cp .env.example .env
```
> **提示**：本项目内置完善的 **Mock 模拟模式**。如果你手头暂时没有 `DEEPSEEK_API_KEY`，可以直接运行全部范例，内置模拟器会精确模拟 DeepSeek 模型的工具调用与思考推演流程！

### 3. 运行教学示例

- **启动 Web 实时可视化控制台 (强烈推荐)**：
  ```bash
  npm run web
  ```
  在浏览器访问 `http://localhost:3000`，体验实时思考推流、多角色协同与沙箱代码实时自愈！

- **运行命令行 Super-Agent 多角色协同任务**：
  ```bash
  npm run superagent
  ```
- **运行基础 ReAct Agent 任务**：
  ```bash
  npm run example:basic
  ```
- **体验自定义插件扩展 (防篡改守卫)**：
  ```bash
  npm run example:plugin
  ```
- **体验会话轨迹回放 (Replay)**：
  ```bash
  npm run example:replay
  ```
- **体验 Python 单文件对照版**：
  ```bash
  python3 python_version/mini_dsh.py
  ```

---

## 📖 推荐学习顺序

1. **第 1 步：阅读文档 [`docs/01_deepseek_harness_architecture.md`](docs/01_deepseek_harness_architecture.md)**
   掌握 DeepSeek Harness 的背景、为什么需要 Harness，以及 Cordis 微内核的运行机理。
2. **第 2 步：查看代码 [`src/core/types.ts`](src/core/types.ts) 和 [`src/core/context.ts`](src/core/context.ts)**
   理解服务上下文是如何实现插件加载、依赖注入和事件监听的。
3. **第 3 步：运行 [`examples/01_basic_agent.ts`](examples/01_basic_agent.ts)**
   观察一个编程任务是如何通过“模型推理 -> 触发 Tool Call -> 沙箱执行 -> 观测结果 -> 自主排错”完成的。
4. **第 4 步：深入 [`docs/04_router_worker_superagent.md`](docs/04_router_worker_superagent.md) 与 [`examples/04_router_worker_task.ts`](examples/04_router_worker_task.ts)**
   理解 DeepSeek Super-Agent 原型如何将大任务拆分，由 Router 协调 Explorer、Coder、Reviewer 协同工作。

