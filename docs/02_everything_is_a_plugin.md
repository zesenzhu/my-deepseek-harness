# 02. 一切皆插件（Everything is a Plugin）

🟢 **本篇可信度：事实** —— 核心判断与真实 DSH 一致（官方描述即 "Everything is a Plugin"，底层为 Cordis）。

> ✅ 这一篇的核心判断是**准确**的：DSH 的官方描述就是 "Everything is a Plugin"，底层确实是 Cordis。
> 但下面的"五类插件"是本项目的教学归纳，真实 DSH 按领域拆成了 329 个包、59 个分组。

## 1. Cordis 微内核架构哲学

DeepSeek Harness 的技术底层构建在 **Cordis** 之上。
Cordis 是一个轻量级、面向服务的依赖注入与微内核框架。在 Cordis 的世界里：
> **“内核只提供总线与生命周期，一切功能皆由插件提供。”**

### 核心三要素
1. **Context（服务上下文）**：一个可嵌套的树状容器，负责管理所有注入的服务和事件监听器。
2. **Service（服务）**：向 Context 暴露的具体能力（例如 `ctx.model`、`ctx.tools`、`ctx.session`）。
3. **Plugin（插件）**：一个纯函数或类，接收 Context 并向其注入服务或注册行为。

---

## 2. 插件的加载与卸载生命周期

在传统的模块系统中，`require` 或 `import` 之后很难完全卸载。Cordis 引入了**作用域可注销机制（Disposable Scope）**：

```typescript
// 插件标准签名
export function MyPlugin(ctx: Context, options: MyPluginOptions) {
  // 1. 注册服务或扩展能力
  ctx.provide('myService', new MyService());

  // 2. 监听生命周期或事件
  const disposeEvent = ctx.on('agent:step:before', (step) => {
    console.log(`Step ${step.index} is about to execute`);
  });

  // 3. 返回清理钩子（当插件被 unload 时自动调用）
  return () => {
    disposeEvent();
    console.log('MyPlugin cleaned up safely');
  };
}
```

---

## 3. DeepSeek Harness 中的插件分类

为了便于入门，下面按职责把插件归成五类。**注意：这是教学归纳，不是 DSH 的官方分类。**
真实 DSH 的划分粒度细得多（`packages/` 下 59 个分组），例如 `core/session`、`core/tools`、`core/agent-loop`、`llm/llm`、
`sandbox`、`compaction`、`subagent`、`session-format` 各自独立成包。

| 插件类别 | 职责说明 | 典型实现 / 接口 |
| :--- | :--- | :--- |
| **Model Adapter** | 统一不同 LLM 厂商的调用协议、流式输出与 Token 计数 | `DeepSeekAdapter`, `OpenAIAdapter`, `BedrockAdapter` |
| **Tool Registry** | 向 Agent 暴露可执行的函数定义与沙箱安全调用执行器 | `FileSystemTools`, `BashRunnerTools`, `GitTools` |
| **Agent Loop** | 定义智能体思考与行动的步进策略（决策状态机） | `ReActLoop`, `PlanSolveLoop`, `RouterWorkerLoop` |
| **Session Store** | 负责事件轨迹（Trajectory）的内存维护与磁盘持久化 | `FileSessionStore`, `SQLiteSessionStore`, `MemoryStore` |
| **Guardrail & Hook** | 拦截非法指令、敏感命令审计、花费阈值控制 | `CommandWhitelistGuard`, `CostLimiter` |

---

## 4. 实战：编写一个自定义插件

假设我们要为一个 Agent 增加一个“代码字数与复杂度安全审计插件”：

```typescript
import { Context, Plugin } from '../core/types.js';

export interface AuditConfig {
  maxFileSize: number; // 允许修改的最大字符数
}

export const CodeAuditPlugin: Plugin<AuditConfig> = (ctx: Context, config) => {
  // ✅ 必须生效的准入控制 → 注册策略（deny 时工具根本不会被执行）
  const disposePolicy = ctx.get('policies').use({
    name: 'audit/max-file-size',
    check(call) {
      if (call.name !== 'file_write') return { decision: 'allow' };
      const content = String(call.args.content ?? '');
      if (content.length > config.maxFileSize) {
        return {
          decision: 'deny',
          reason: `内容长度 ${content.length} 超过上限 ${config.maxFileSize}`,
          code: 'PROTECTED_PATH',
        };
      }
      return { decision: 'allow' };
    },
  });

  // ✅ 纯观察的日志/遥测 → 用事件
  const disposeEvent = ctx.on('agent:finished', (payload) => {
    console.log(`[Audit Plugin] Task finished: ${payload.result}`);
  });

  return () => {
    disposePolicy();
    disposeEvent();
  };
};
```

通过这种架构，你可以在完全不侵入主逻辑的前提下，任意扩展 Agent 的能力与审计控制！

> ⚠️ **最容易踩的坑**：不要用 `ctx.on('tool:before_call', () => { throw ... })` 来做拦截。
> 事件派发是"通知"语义，`emit` 为了避免一个监听器拖垮整条链路会吞掉异常——
> 结果就是守卫只打了一行日志，工具照常执行。这是本项目早期真实存在的 Bug，
> 现在由 `src/core/policy.ts` 的裁决管线保证拦截生效。详见 [00_real_dsh_map.md](00_real_dsh_map.md) 第 2 节。

