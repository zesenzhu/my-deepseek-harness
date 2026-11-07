# 08. 真实组合包配置树（离线可复现）

> 🟢 **本篇可信度：事实**
> 所有 YAML 摘录都来自官方 npm 发行物 `@deepseek-ai/dsh-base@0.0.1-rc.1` 与 `@deepseek-ai/dsh-web-app@0.0.1-rc.1`，
> 原件已存入 [`fixtures/real-dsh/`](../fixtures/real-dsh/)，可用脚本重新拉取与校验。

```bash
node scripts/fetch-real-bundles.mjs    # 重新拉取（只下载 3 个小包，不装 329 个依赖）
node scripts/analyze-bundle-tree.mjs   # 分析并打印统计
node scripts/analyze-bundle-tree.mjs --web --rows   # 看明细
```

---

## 1. 三个数字先建立体感

| 指标 | 数量 |
|---|---|
| 发行版依赖的 `@deepseek-ai/*` 包 | **329** |
| 仓库 `packages/` 顶层分组 | **59** |
| **一棵真实的 web 树实际挂载的配置行** | **148**（base 78 插入 + web-app 39 插入 / 3 覆盖 / 24 禁用 + windows 2 插入 / 2 禁用） |

也就是说：**"装了 329 个包"≠"挂了 329 个插件"**。真正的树是按 profile 用 patch 叠出来的，
没被选中的包就只是躺在 `node_modules` 里。

---

## 2. 三种 patch 动作（真实数据里的分布）

| 动作 | 写法 | base | web-app |
|---|---|---|---|
| 插入 | `- insert:` 下的行，必须带 `name` | 78 | 39 |
| 覆盖 | 顶层 `- id: x` + `config:` | 0 | 3 |
| 禁用 | 顶层 `- id: x` + `disabled: true` | 0 | 24 |

真实文件里对语义写得很直白（`base.cordis.patch.yml` 文件头）：

> The dsh-base bundle patch: the shared core of every dsh profile, applied as **ONE insert over the empty profile root**.
> Later bundle patches and the user's profile `cordis.patch.yml` address these rows **by id**, with **the last write winning per row**.

> **A patch replaces the targeted row's whole `config` rather than merging into it**, so a row whose value differs by mode does NOT live here.

> **Row order carries no load semantics (activation is service-availability driven)**; the grouping is for readers.

这三句话解释了三件最容易误解的事：

1. **profile 根是空的**，树是"一个 insert + 若干 patch"叠出来的
2. **patch 是替换，不是深合并**——所以每行都得把键写全
3. **行序不代表加载顺序**——激活由"它依赖的服务是否就绪"决定

---

## 3. 领域分布：这棵树长什么样

`node scripts/analyze-bundle-tree.mjs` 的统计（按挂载条目数）：

```text
client-ui         21   ████████████████████████████
tool              17   ███████████████████████
session            9   ████████████
subagent           5   ███████
client             5   ███████
llm / agent / web  4   各 █████
skill / command / storage / host  3
其余 sandbox/bash/fs/goal/compact/spill/plan/workflow/... 各 1~2
```

两个观察：

- **界面占大头**（21 个 `client-ui-*`）——所以"DSH 是 Web 产品 + Agent 内核"，不是纯框架
- **模型只有 4 行**（`llm` / `llm-deepseek` / `llm-pi-ai` / `llm-retry`），另有一行 `agent-default-model` 决定默认路由
  —— 印证"模型是插件"，换模型只是改配置

---

## 4. 权限三档：真实配置长什么样

`base.cordis.patch.yml` 里的 `permission` 行，是整份文件里最有教学价值的一段：

```yaml
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    # 默认 ask；只有显式切到 danger-full-access 才是 never
    policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"

- id: permission
  name: '@deepseek-ai/dsh-permission'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
```

三个细节值得注意：

1. **默认 `ask`，不是 `allow`** —— 这就是"失败关闭"的来源
2. **`sandbox` 与 `approval` 是两个正交维度**：沙箱决定"能不能写"，审批决定"要不要问人"
3. **配置里可以有 `!!js` 表达式**（读环境变量）——但只在配置求值时执行，不是任意代码

对比本项目的 [policy.ts](../src/core/policy.ts)：我们实现了 `allow / deny / ask` 三态与"无审批器则失败关闭"，
但 `ask` 只是一个回调，没有真正的 UI 审批链路；也没有 `read-only` 模式（我们的守卫只做路径 jail）。

---

## 5. 为什么 web 层要禁用 24 个条目？

打开 `web-app.cordis.patch.yml`，会看到一整段带注释的"搬迁说明"：

```yaml
# ── the agent plane moves behind agent presets ─────────────────────────────
# Web surface disables them here and lets each session mount a preset instead.

- id: tool-bash
  disabled: true
- id: tool-fs
  disabled: true
- id: tool-skill
  disabled: true
- id: tool-goal
  disabled: true
```

配套的注释解释得很细，核心逻辑是：

> The `goal` SERVICE, its session driver, and the `/goal` command STAY on the host plane;
> only the model-facing tool moves. … a per-session realm would answer `service-unavailable`
> for every browser call. That is the `bash-env` criterion read from the other side:
> **injection is not the only host relationship a Service can have.**

翻译成人话：

- **服务（Service）**留在宿主平面，所有会话共用一份
- **面向模型的工具（tool-*）**改为按 agent preset 挂载，每个会话有自己的"领域（realm）"
- 判断某个东西该放哪层，看的是"它和别的服务是什么关系"——是**注入依赖**，还是**运行时读取**

这就解释了为什么 **`disabled: true` 绝不等于"没这个能力"**：这些工具只是从"全局"挪到了"每个 agent 的 preset 里"。

> 这一条是本篇最值得记住的：**插件树不是平的，它有"平面（plane）"和"领域（realm）"之分。**

---

### 补充：Windows 层是最干净的"整层替换"示例

`base.windows.cordis.patch.yml` 只有 4 行，把话说得非常清楚：

```yaml
# bash 在 Windows 上没有运行器，整条技术栈（bash-sandbox/tool-bash）被禁用
- id: bash-sandbox
  disabled: true
- id: tool-bash
  disabled: true

- insert:
    - id: pwsh-sandbox
      name: '@deepseek-ai/dsh-pwsh-sandbox'
    - id: tool-pwsh
      name: '@deepseek-ai/dsh-tool-pwsh'
```

**2 禁用 + 2 插入 = 换掉一整套 shell 能力，零代码改动。** 这就是"层"能买到的东西。

---

## 6. 与本项目的对照

| 真实 DSH | 本项目 | 差距的本质 |
|---|---|---|
| 148 行配置的树，由 bundle + patch 叠出 | 5 行 `.use()` 链，写死在 `web-entry.ts` | 缺"层"与"行"的概念 |
| 三种动作：insert / override / disable | 只有"挂载"一种 | 无法在不改代码的前提下禁用某个能力 |
| 行由 `id` 定位，可被多层覆盖 | 插件按数组顺序执行 | 无法覆盖，只能重写入口 |
| 激活由 service-availability 决定 | 按 `.use()` 顺序同步装配 | 没有延迟激活/按需激活 |
| `disabled` 可把能力移到 preset realm | 无 realm 概念 | 所有插件共享同一个 ctx |

---

## 7. 三分钟自检

1. `node scripts/analyze-bundle-tree.mjs` 输出的总行数是多少？为什么不是 329？
2. `disabled: true` 的 24 行，能力真的消失了吗？
3. 为什么默认审批策略是 `ask` 而不是 `allow`？
4. "行序无加载语义"意味着插件加载时依据什么？
5. 如果想给 web profile 换默认模型，应该改哪一层？（提示：不是 base，也不是 web-app）

答案都在本文与 [`07_real_plugin_tree.md`](07_real_plugin_tree.md) 里。
第 5 题的准确答案是：**用户自己的 `cordis.patch.yml`**（你机器上是 `~/.dsh/profiles/desktop/cordis.patch.yml`），
用 `- id: agent-default-model` 覆盖 `config`，因为"最后一个写入者赢"。

---

## 附：数据来源与许可

- 来源：npm `@deepseek-ai/dsh-base@0.0.1-rc.1`、`@deepseek-ai/dsh-web-app@0.0.1-rc.1` 包内的 `cordis.patch.yml`
- 许可：**BSD 3-Clause**（`Copyright (c) 2026, DeepSeek`），本仓库仅作学习用途的只读副本，未作修改
  - 完整许可文本与商标说明已收录到仓库根的 [LICENSE](../LICENSE) 第三方内容说明部分
- 校验和见 [`fixtures/real-dsh/README.md`](../fixtures/real-dsh/README.md)
- 这些是**发行版快照**，会随版本演进；权威数据永远是你本机安装的那份
