# 07. 解剖真实 DSH：你本机那棵插件树

> 这一篇和 01~06 不同：它讲的**全部是真实产物**，不是类比。
> 所有内容都可以用 `node scripts/inspect-real-dsh.mjs` 在你自己的机器上复现。

---

## 1. 先看目录：DSH home 里有什么

装完之后，`~/.dsh/`（可用 `DSH_HOME` 覆盖）大致长这样：

```text
~/.dsh/
├── profiles/
│   └── desktop/                    # 一个 profile = 一次完整装配
│       ├── cordis.yml              # 根条目列表（注释明确说：是空的！）
│       ├── package.json            # 声明用哪些组合包（bundle）
│       ├── cordis.patch.yml        # 你自己的覆盖层
│       └── pnpm-workspace.yaml
├── sessions/
│   └── --<workspace 路径编码>--/
│       └── session-<uuid>/
│           ├── session.v4.jsonl.zstd   # 会话日志（zstd 压缩的 JSONL）
│           └── session.lock
├── storages/                       # 工作区、设置等持久状态
├── .credentials.yaml
└── .anonymous-user-id
```

关键点：**没有"主配置"**。`cordis.yml` 里就一句注释 + `[]`：

```yaml
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
```

这句话就是整个架构观的浓缩：**树不是写死的，是一层层叠出来的补丁。**

---

## 2. 装配顺序：bundle → patch → overlay

```text
  ① 空条目列表  []
        │
        │  按 package.json 里 dsh.profile.bundles 的顺序叠加
        ▼
  ② @deepseek-ai/dsh-base        模型适配、工具、持久化、沙箱、审批、设置、凭据、遥测
        │
        ▼
  ③ @deepseek-ai/dsh-web-app     浏览器应用（前端、聊天 UI、插件市场 UI…）
        │
        ▼
  ④ cordis.patch.yml             你自己写的层（按 id 定位条目，替换它的整个 config）
        │
        ▼
  ⑤ --patch overlay              命令行临时覆盖（优先级最高）
        │
        ▼
     运行中的插件树
```

本机 `profiles/desktop/package.json` 的声明就两行：

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
```

其他模板还有 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`
（`dsh --profile web` 与 `dsh web` 选择的是同一个东西的不同写法）。

---

## 3. 真实的 patch 条目长什么样

本机 `cordis.patch.yml` 里有 5 条（用 `--patch` 可列全）：

| id | 插件 | 作用 |
|---|---|---|
| `agent-default-model` | `dsh-agent-default-model` | 指定默认 provider/model |
| `ui-settings-account` | `dsh-client-ui-settings-account` | 账户页展示粒度 |
| `ui-chat` | `dsh-client-ui-chat` | 对话记录view 的详细程度 |
| `ui-settings` | `dsh-client-ui-settings` | 设置面板开关 |
| `llm-pi-ai` | `dsh-llm-pi-ai` | 定义可用的 LLM provider 与其 model 列表 |

其中最有教学价值的是这两条：

```yaml
# 决定"新建会话默认用哪个模型"
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: moying
    model: deepseek-v4.1-flash

# 决定"模型选择器里能看到哪些模型"
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      moying:
        apiKeyEnv: MOYING_API_KEY
        api: openai-completions
        baseURL: https://llm-gateway.moyingrobotics.com/v1
        models:
          - id: claude-sonnet-5-5
            name: claude-sonnet-5-5
          # … 50 多个模型
```

### patch 的语义（容易误解，务必记牢）

- **按 `id` 定位**：`id` 是条目的稳定标识，`name` 是包名
- **替换整个 `config`**，不是深合并：想保留 bundle 里的某个字段，就得在 patch 里整段写全
- **可以禁用**（`disabled`）、**可以插入新条目**（`insert`）
- **`!!js` 表达式**允许在 yaml 里做少量计算
- 层有优先级：profile patch < home patch < `--patch` overlay（所以你永远能临时覆盖，不用改文件）

这套机制正是论文里"时空可组合性"的落地：**每一层都可以单独加、单独撤、单独回滚，互不污染。**

---

## 4. 对照：本项目的装配 vs 真实装配

| 真实 DSH | 本项目 | 差异 |
|---|---|---|
| `dsh-base` 组合包（上百个条目） | `DeepSeekHarness` 构造函数里 `provide('session'/'policies'/'tools')` | 我们只有 3 个基础服务 |
| `dsh-web-app` 组合包（前端 + UI 插件 50+） | `WebServerPlugin`（164 行原生 HTTP） | 我们用 SSE + 单页 HTML |
| `cordis.patch.yml` 按 id 改 config | `.use(Plugin, options)` 直接传对象 | 我们没有"层"的概念，改配置只能改代码 |
| `--patch` overlay | 无 | 我们没有运行时覆盖能力 |
| `dsh --profile <name>` 选组装 | 无（只有 `src/index.ts` 与 `src/web-entry.ts` 两条硬编码链） | 想换装配就得新建入口文件 |

我们的 `harness.use(...)` 链，本质上等价于"**一层写死的 bundle**"：

```ts
new DeepSeekHarness()
  .use(DeepSeekModelPlugin)          // ≈ bundle 里的模型适配条目
  .use(SandboxGuardPlugin, { ... })  // ≈ bundle 里的 sandbox/approval 条目
  .use(RealFSToolsPlugin, { ... })   // ≈ bundle 里的工具条目
  .use(SuperAgentLoopPlugin, { ... })// ≈ bundle 里的 agent-loop 条目
```

**这就是理解真实 DSH 最省力的入口**：如果你能把 `.use()` 链想象成"一堆可以被 id 定位、被 patch 覆盖的条目"，
你就已经理解 profile 了。

---

## 5. 会话日志：真实格式

本机会话目录里是 `session.v4.jsonl.zstd`，解压后是 JSONL（每行一个事件）。
文件头一行长这样（字段名取自真实文件，值已脱敏）：

```json
{
  "type": "session",
  "version": 4,
  "id": "…",
  "createdAt": 1793957323999,
  "cwd": "…",
  "isSeeded": false,
  "delegationDepth": 0,
  "agentPreset": "standard"
}
```

几个值得注意的点：

- **`version: 4`**：日志格式有版本号，仓库里有 `dsh-session-format-v0-to-v1` … `v3-to-v4` 四条迁移包，
  说明升级时是**迁移旧日志**，不是丢弃
- **`delegationDepth`**：子 agent 的委派深度（对应 `dsh-subagent`）
- **`agentPreset`**：会话用的 preset（`standard` 等），对应 `dsh-agent-preset-registry`
- **`isSeeded`**：是否是预置/种子会话
- **zstd 压缩的 JSONL**：既可流式追加，又省磁盘
- 旁路还有 `session.lock`：多进程同时写同一会话时的锁

对比本项目的 [session.ts](../src/core/session.ts)：我们只有 `id/timestamp/type/payload/metadata`，
内存数组、关掉进程就没了。**真实实现要处理格式版本、迁移、锁、压缩、校验、投影、查询。**

---

## 6. 动手实验（3 分钟）

### 实验 A：看清你自己的装配

```bash
node scripts/inspect-real-dsh.mjs --patch
```

你应该会看到 profile 列表、patch 条目表、以及"当前默认模型来自哪个 patch"。

### 实验 B：把默认模型换掉

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml` 里的 `agent-default-model`：

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: moying
    model: gpt-5.6-luna     # ← 换成你想试的模型 id（必须在 llm-pi-ai 的 models 里存在）
```

重启应用 → 新建会话就是新默认模型；**已存在的会话不受影响**（因为路由记录在会话日志里）。
想撤销：改回去，或者删掉这一条（回落到 bundle 的默认值）。

> 这就是"层"的好处：**改配置不需要改代码，也不需要重建 bundle。**

### 实验 C：看完整生效配置

如果你另外装了 npm 版 CLI：

```bash
npx @deepseek-ai/dsh --profile web --dump-config
```

它会打印叠加所有层之后**真正生效**的完整配置树 —— 这是排查"我改的 patch 到底生效没有"的终极手段。
桌面版把运行时打在 `app.asar` 里，没暴露这个命令，但第 6.1 节的探查脚本能覆盖大部分需求。

---

## 7. 读到这里你应该能回答的问题

1. 为什么 `cordis.yml` 是空数组，而插件树照样能起来？（→ 树由 bundle + patch 叠加而成）
2. 为何 patch 改一个字段要把整个 `config` 重写？（→ 语义是替换，不是深合并）
3. 为什么"换默认模型"能只改一个 YAML、不动任何代码？（→ 模型适配器是插件，路由是配置）
4. 会话日志为什么要带 `version`？（→ 格式演进 + 迁移链，旧日志不能作废）
5. 本项目缺的是"哪些层"而不是"哪些代码"？（→ 缺的是 profile / bundle / patch 这套**分层装配**能力）

如果这 5 个问题都能顺着本文答出来，你已经比"只看过 README"的人更接近真实 DSH 了。

---

## 8. 下一步：看真实配置树

本机 profile 只是"用户层"，真正 148 行的树在官方组合包里。
**[08_real_bundle_tree.md](08_real_bundle_tree.md)** 已经把 `@deepseek-ai/dsh-base` 与 `dsh-web-app` 的
`cordis.patch.yml` 原件存进 `fixtures/real-dsh/`，并配了分析脚本：

```bash
npm run analyze
```

你会看到 base 78 行 insert、web-app 39 行 insert + 3 覆盖 + 24 禁用，
以及权限三档（`read-only` / `workspace-write` / `danger-full-access`）在真实配置里到底怎么写的。
