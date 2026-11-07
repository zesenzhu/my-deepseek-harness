# 06. DeepSeek Harness 全栈与 Super-Agent 架构深度研学与实战分析

🔴 **本篇可信度：讲的是本项目 demo** —— 本文解析本仓库自己的实现，与 DSH 无对应关系；真实架构请看 00 / 07。

> ⚠️ **阅读前必看**：本文解析的是**本仓库自己实现的这个 demo**（约 1500 行），
> 它借用了 DSH 的设计思想，但**不是** DSH 的架构说明。
> 文中出现的 "SuperAgentLoopPlugin"、"Router-Worker 拓扑" 都是本项目的教学组件，
> 真实 DSH 的对应包与差距见 [00_real_dsh_map.md](00_real_dsh_map.md)。

本文档对本仓库构建的全栈自主智能体 demo 做系统解构。

---

## 1. 核心架构全景图 (System Architecture)

在本教学实现中，系统自下而上划分为四大层次：

```
+-----------------------------------------------------------------------------------+
|                        Web Visualization Dashboard (UI)                           |
|      - 任务下达输入框  - 实时 SSE 思考流与工具卡片  - 沙箱源码动态 Diff  - 轨迹回放      |
+-----------------------------------------------------------------------------------+
                                         ^
                                         | (Server-Sent Events: /events)
+-----------------------------------------------------------------------------------+
|                     Interface & Telemetry Plugin Layer                            |
|      - WebServerPlugin (原生 Node.js HTTP + SSE 实时推流广播)                       |
|      - TrajectoryStorePlugin (不可变追加事件流持久化)                                |
+-----------------------------------------------------------------------------------+
                                         ^
                                         | (EventBus & Context Services)
+-----------------------------------------------------------------------------------+
|                  Core Execution Engines (Agent Loops)                             |
|      - SuperAgentLoopPlugin: Router-Worker 多智能体拓扑                             |
|          * Router: 需求拆解与 DAG 依赖编排                                         |
|          * Explorer: 工作区结构只读探测与符号索引                                    |
|          * Coder: 错误日志分析与自愈补丁生成                                        |
|          * Tester: 真实沙箱自动化测试与回归验收                                     |
|      - ReActLoopPlugin: 单 Agent 思考-行动-自愈标准循环                             |
+-----------------------------------------------------------------------------------+
                                         ^
                                         | (Tool Calls & Guardrails)
+-----------------------------------------------------------------------------------+
|                     Environment & Sandbox Guardrail Layer                         |
|      - RealFSToolsPlugin (工作区文件系统真实读写与子进程 Shell 执行)                 |
|      - SandboxGuardPlugin (工作区 Jail 路径防穿越、危险指令黑名单熔断)                |
|      - DeepSeekModelPlugin (真实 API 请求 / 智能无损全真模拟器)                     |
+-----------------------------------------------------------------------------------+
```

---

## 2. 核心机制深度解析

### 2.1 Cordis 风格微内核：服务总线与时空解耦
在 [`src/core/context.ts`](../src/core/context.ts) 中，我们实现了一个纯正的 Cordis 风格容器：
- **依赖倒置**：任何插件不依赖具体实现，只依赖 Context 契约。
  例如，`SuperAgentLoopPlugin` 执行工具时，并不关心底层是虚拟内存文件系统还是真实物理磁盘，它只需调用 `ctx.get('tools').execute(...)`。
- **可撤销的作用域 (Disposers)**：
  每个插件在挂载时返回一个 `cleanUp` 闭包函数。当某个插件被卸载时，其监听的事件总线与暴露的服务被自动安全注销，**绝不在宿主环境中留下内存泄漏或脏状态**。

### 2.2 工作区沙箱 (Workspace Jail) 与命令防护
在自主 Agent 赋予真实系统执行权限时，安全是头等大事。在 [`src/plugins/guardrails/sandbox-guard.ts`](../src/plugins/guardrails/sandbox-guard.ts) 中：
1. **路径解析规整化**：
   使用 `path.resolve(workspaceRoot, targetPath)`，再用 `path.relative` 判定是否仍在工作区内
   （不要用 `startsWith`：`/work` 会放行 `/workspace-evil`），最后对"最近的已存在祖先"做 `realpath` 校验，防符号链接逃逸。
   即使 Agent 生成了 `../../etc/passwd`，也会在工具调用前被**策略裁决**拦截并返回失败结果。

   > ⚠️ 注意：拦截必须是裁决（verdict），不能是事件监听器里 `throw`。
   > 早期版本就是 `throw`，而 `emit` 会吞异常，实测 `../escape-proof.txt` 能写到工作区外、`rm -rf /` 能真的进 shell。
2. **Shell 命令双重过滤**：
   - 提取主进程名实施**白名单比对**（仅允许 `node`, `npm`, `git`, `python` 等）；
   - 正则检测破坏性指令（如 `rm -rf /`、Fork Bomb、直接重定向底层设备），确保开发者宿主机安全。

### 2.3 Super-Agent 多角色协同与自愈闭环 (Self-Healing)
单 Agent 面对复杂报错时容易陷入“尝试相同方案 -> 再次报错”的死锁。而在 [`src/plugins/loops/superagent-loop.ts`](../src/plugins/loops/superagent-loop.ts) 中：
1. **Explorer 先行降噪**：先进行只读扫描，仅将关键代码片段喂给下游，避免主上下文被冗余代码填满；
2. **Tester 复现提取**：运行真实的测试套件（如 `node test.js`），提取带有行号和断言详情的真实红灯堆栈；
3. **Coder 靶向修复**：依据测试反馈精准修复（例如将反向的 `1 + discount/100` 纠正为 `1 - discount/100`，并补充除零防御）；
4. **Tester 回归验收**：确保全绿（Green Light）才向 Router 交付，形成严格的闭环。

### 2.4 原生 SSE 实时流推机制
在 [`src/plugins/web/server.ts`](../src/plugins/web/server.ts) 中：
- 采用 HTTP Server-Sent Events (`text/event-stream`) 协议；
- Harness Context 中的任何事件（Agent 开始、模型思考、工具调用前后、测试通过等）均通过统一事件总线广播；
- 浏览器端无需轮询，前端 `EventSource('/events')` 会毫秒级接收到数据包并动态渲染卡片。

---

## 3. 快速上手操作指南

### 3.1 启动 Web 实时可视化看板
在项目根目录下执行：
```bash
cd deepseek-harness-study
npm run web
```
终端会输出：
```text
🌐 [DeepSeek Harness Web Console] 服务已启动: http://localhost:3000
📡 SSE 事件流端点就绪: http://localhost:3000/events
```
在浏览器中打开 `http://localhost:3000`：
1. 你将看到包含当前状态、工具触发数、事件总数的深色仪表盘；
2. 点击 **“⚡ 立即启动任务”**，即可亲眼目睹 Explorer -> Tester -> Coder -> Tester 的实时推流执行；
3. 右侧面板会实时从“存在 Bug 的源码”自动同步变更为“修复后的完美源码”！

### 3.2 运行命令行示例
如果你更习惯在终端中学习，我们也提供了丰富的预置命令：
- **基础 ReAct 循环**：`npm run example:basic`
- **自定义插件拦截演示**：`npm run example:plugin`
- **事件轨迹回放 (Replay)**：`npm run example:replay`
- **Super-Agent 协同脚本**：`npm run example:router-worker`
- **Python 单文件纯原生演示**：`python3 python_version/mini_dsh.py`

---

## 4. 思考与进阶拓展

1. **如何接入自己的真实 DeepSeek API？**
   在 `.env` 中配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`，并设置 `EXECUTION_MODE=live`。
   注意：示例 1~4 用的是**内存沙箱**（`file_read`/`bash_run` 在虚拟文件系统上工作），
   换成真模型后它只能看到虚拟文件；想体验"真实磁盘 + 真实子进程"，用 `npm run example:real`。
2. **如何增加一个新的 Worker 角色？**
   只需在 `src/plugins/loops/` 中定义新的角色契约，例如增加一个 `Reviewer Worker`（用于代码规范审计与安全扫描），通过 Context 的事件总线与 Router 建立通讯。

