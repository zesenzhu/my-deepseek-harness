# fixtures/real-dsh —— 真实 DSH 组合包配置快照

这里存放的是从 npm 上原样取回的 **真实组合包（bundle）配置文件**，用于离线分析真实插件树。
它不是本项目写的配置，而是 DeepSeek 官方发行物的一部分（**BSD 3-Clause License**）。

## 来源

| 文件 | 来自 | 版本 | 说明 |
|---|---|---|---|
| `base.cordis.patch.yml` | `@deepseek-ai/dsh-base` | `0.0.1-rc.1` | 所有 profile 共享的第一层：模型、工具、会话、沙箱、审批、设置、遥测 |
| `base.windows.cordis.patch.yml` | 同上 | `0.0.1-rc.1` | Windows 平台的覆盖层 |
| `web-app.cordis.patch.yml` | `@deepseek-ai/dsh-web-app` | `0.0.1-rc.1` | 浏览器表面：在 base 之上叠加，覆盖 + 插入 UI/工具相关条目 |

取回方式（可复现）：

```bash
npm pack @deepseek-ai/dsh-base @deepseek-ai/dsh-web-app --pack-destination .tmp/packs
tar xzf .tmp/packs/deepseek-ai-dsh-base-0.0.1-rc.1.tgz -C .tmp/packs/base --strip-components=1
```

或直接用仓库里的脚本：

```bash
node scripts/fetch-real-bundles.mjs          # 重新拉取并刷新本目录
node scripts/analyze-bundle-tree.mjs         # 分析并打印统计
```

## 校验和（SHA-256）

```text
8751a2c88df4d199309f42f1a76906880866bbc059d0cd42901b2b6628e29257  base.cordis.patch.yml
d821d6c2f2d4bcd7660986bed413c1811af0eaf1aaae9f148f2f3ead14bbf603  base.windows.cordis.patch.yml
99f659023c552b5a38146150e49cd2c612b9c026b69d7e84bd2a24b4babe75a7  web-app.cordis.patch.yml
```

> ⚠️ 这些是**发行版快照**，会随版本演进。本项目锁定 `0.0.1-rc.1`；
> 真正权威的永远是你本机安装的那份（见 `scripts/inspect-real-dsh.mjs`）。

## 许可

原文件版权归 DeepSeek AI（`Copyright (c) 2026, DeepSeek`），随包附带的 LICENSE 为 **BSD 3-Clause**。
这里仅作学习用途的只读副本，未作修改；完整的第三方许可文本已收录到仓库根的 [LICENSE](../LICENSE)。
