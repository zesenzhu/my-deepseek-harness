# 文档索引与阅读路线

> 本目录的文档质量**不均匀**，请按下面的"可信度"标签取舍：
>
> - 🟢 **事实**：可直接当作 DSH 行为依据（有官方仓库/产物佐证）
> - 🟡 **类比**：借真实概念讲解，但映射关系是本项目自建的
> - 🔴 **教学建模**：本项目自家 demo 的说明，与 DSH 无对应物

| 篇目 | 主题 | 可信度 | 对应真实包 / 佐证 |
|---|---|---|---|
| [00_real_dsh_map.md](00_real_dsh_map.md) | 事实卡、勘误表、包族映射 | 🟢 | 仓库 + 发行版产物统计 |
| [01_deepseek_harness_architecture.md](01_deepseek_harness_architecture.md) | 架构总览、为什么需要 harness | 🟡 | 3.3 节的 Router-Worker 是类比 |
| [02_everything_is_a_plugin.md](02_everything_is_a_plugin.md) | 插件 / 服务 / 生命周期 | 🟢 | `@deepseek-ai/cordis@4.1.0`、`dsh-tools` |
| [03_agent_runtime_and_react_loop.md](03_agent_runtime_and_react_loop.md) | 循环、自愈、熔断 | 🟡 | 真实为 `dsh-agent-loop`、`dsh-repeat-tool-reminder` |
| [04_router_worker_superagent.md](04_router_worker_superagent.md) | 多角色协作 | 🟡 | 真实为 `dsh-subagent` / `dsh-workflow` / `team` |
| [05_session_and_event_sourcing.md](05_session_and_event_sourcing.md) | 事件溯源、回放、分叉 | 🟡 | 真实为 `dsh-session` + `-format-v0..v4` |
| [06_fullstack_superagent_deep_dive.md](06_fullstack_superagent_deep_dive.md) | 本项目 demo 的全栈解析 | 🔴 | 讲的是本仓库代码，不是 DSH |
| [07_real_plugin_tree.md](07_real_plugin_tree.md) | 解剖本机真实插件树 | 🟢 | `~/.dsh/profiles/*`、`session.v4.jsonl.zstd` |
| [08_real_bundle_tree.md](08_real_bundle_tree.md) | 真实组合包配置树（148 行） | 🟢 | `fixtures/real-dsh/*.yml`（官方发行物） |

---

## 推荐路线

### 路线 A：我想先搞懂"harness 是什么"（约 2 小时）

1. [00](00_real_dsh_map.md) —— 建立坐标，知道哪些是真的
2. [01](01_deepseek_harness_architecture.md) —— 为什么要 harness、它解决什么问题
3. [02](02_everything_is_a_plugin.md) + `src/core/context.ts` —— 插件/服务/可撤销副作用
4. `npm run example:real` —— 看一次真实闭环

### 路线 B：我想写出自己的 Agent 框架（约 1 天）

1. 路线 A
2. `src/core/registry.ts` + `src/core/policy.ts` —— **准入策略管线**（最容易被做错的地方）
3. [03](03_agent_runtime_and_react_loop.md) + `src/plugins/loops/react-loop.ts` —— 循环与熔断
4. [05](05_session_and_event_sourcing.md) + `npm run example:replay` —— 事件溯源
5. `tests/run.ts` —— 15 个用例，对着看每个设计的"为什么"

### 路线 C：我想真正读懂 DSH 源码（约 1 周）

1. [00](00_real_dsh_map.md) → [07](07_real_plugin_tree.md) → [08](08_real_bundle_tree.md) —— 先看清分层装配与真实产物
2. `node scripts/inspect-real-dsh.mjs --patch` + `node scripts/analyze-bundle-tree.mjs --web` —— 本机 profile 与官方 bundle 对照
3. 官方仓库 `docs/cordis-primer.zh.md` → `docs/cordis-tutorial/`
4. 官方 `docs/architecture.zh.md` —— profile / bundle / patch 与核心 ctx 键
5. 官方 `packages/core/*`、`packages/llm/*` 的 `README.zh.md`（每包都有中英双语）
6. 官方 `docs/config-catalog.zh.md` —— 所有插件配置字段（自动生成，不会过期）

---

## 一句话原则

**先分清"哪些是 DSH 的事实、哪些是本项目的建模"，再决定读哪篇。**
所有不确定的地方，去 [00](00_real_dsh_map.md) 查证；能被 `scripts/inspect-real-dsh.mjs` 验证的，就别只信文档。
