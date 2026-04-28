# ListenAI Embedded Agent Workbench

<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

ListenAI Embedded Agent Workbench (EAW) 发布一组可复用的 agent-skill 与 hardware-resource packages，用于嵌入式开发和调试工作流。普通使用者应优先从 ListenAI 私有 npm registry 消费这些 packages；这个仓库是贡献者 workspace。

## Packages

面向使用者的 package surface 包括：

- `@listenai/eaw-contracts` - 共享 request/result、inventory、live-capture 与 device-option contracts。
- `@listenai/eaw-resource-client` - 通过 HTTP 调用已运行 resource-manager 服务的 `HttpResourceManager`。
- `@listenai/eaw-resource-manager` - 本地 HTTP 服务、dashboard、DSLogic runtime boundary、inventory、lease 与 live-capture API。
- `@listenai/eaw-skill-logic-analyzer` - 打包后的 logic-analyzer agent skill assets 与 TypeScript runtime entrypoints。

根 package `listenai-embedded-agent-workbench` 保持 private，只用于在 monorepo 中一起开发这些 EAW packages。

## Registry 配置

`@listenai` packages 应从 ListenAI 私有 registry 解析：

```text
https://registry-lpm.listenai.com
```

运行下面命令前，请在你的 npm、pnpm、yarn 或 CI 环境中配置 `@listenai` scope。不要把 registry auth token 提交到仓库。

示例：

```bash
npm config set @listenai:registry https://registry-lpm.listenai.com
pnpm config set @listenai:registry https://registry-lpm.listenai.com
yarn config set npmScopes.listenai.npmRegistryServer https://registry-lpm.listenai.com
```

认证信息应由组织环境或 CI 变量提供。

## 快速开始：安装 agent skill

不添加永久依赖的情况下安装 `logic-analyzer` agent skill：

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-codex ~/.codex/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills
```

如果目标是 Claude Code skill 目录，使用 Claude installer binary：

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-claude ~/.claude/skills
```

如果团队希望用 lockfile 固定 skill 版本，可以把 `@listenai/eaw-skill-logic-analyzer` 加为项目 dev dependency，并在项目脚本里包装 installer。

## 快速开始：运行 Resource Manager

Live DSLogic capture 使用 `@listenai/eaw-resource-manager` 作为硬件权威边界。配置私有 registry 后，从 registry 运行 package binary：

```bash
npm exec --package @listenai/eaw-resource-manager -- \
  resource-manager start --host 127.0.0.1 --port 7600
```

M003 会新增受管理的后台模式：

```bash
npm exec --package @listenai/eaw-resource-manager -- \
  resource-manager start --daemon --host 127.0.0.1 --port 7600

npm exec --package @listenai/eaw-resource-manager -- resource-manager status --json
npm exec --package @listenai/eaw-resource-manager -- resource-manager stop
```

在 daemon mode 发布前，前台启动仍是受支持的运行路径。

检查已运行服务：

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

如果你想看打包后的 dashboard，而不是直接看 JSON，打开 `http://127.0.0.1:7600/`。

## 使用 Runtime Packages

只使用 package-root imports。不要 deep-import package internals。

```ts
import { HttpResourceManager } from "@listenai/eaw-resource-client";
import { runGenericLogicAnalyzer } from "@listenai/eaw-skill-logic-analyzer";

const resourceManager = new HttpResourceManager("http://127.0.0.1:7600");
const result = await runGenericLogicAnalyzer(resourceManager, request);

if (!result.ok) {
  console.error(result.phase, result);
}
```

`@listenai/eaw-skill-logic-analyzer` 支持两种 request mode：

- artifact mode 分析调用方提供的 capture artifact，并可附加离线 protocol decode；
- live mode 通过 resource-manager 分配设备并执行 capture，然后返回标准化 waveform analysis。

成功的 live session 不会自动 release。host 消费完结果后，应通过 package-root skill surface 显式 end session。

## 文档

面向使用者的指南位于 `docs/`：

- `docs/logic-analyzer-agent-skill.md` - 介绍如何将 `@listenai/eaw-skill-logic-analyzer` 作为 Codex、Claude Code 或 GSD/pi 风格 skill 目录中的 agent skill 使用。
- `docs/logic-analyzer-agent-skill.zh-CN.md` - 简体中文版本。

package-owned docs 仍然是 package 本地行为和 installer assets 的权威来源：

- `packages/skill-logic-analyzer/README.md`
- `packages/skill-logic-analyzer/SKILL.md`
- `packages/resource-manager/README.md`

## 贡献者源码工作流

只有在开发这个仓库时，才使用源码 workspace 命令。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

贡献时从源码运行 resource-manager：

```bash
pnpm --filter @listenai/eaw-resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

从源码构建和测试 logic-analyzer package：

```bash
pnpm --filter @listenai/eaw-skill-logic-analyzer typecheck
pnpm --filter @listenai/eaw-skill-logic-analyzer build
pnpm --filter @listenai/eaw-skill-logic-analyzer test
```

## 维护者验证

修改 package publishing 行为前，在仓库根目录运行 focused checks：

```bash
bash scripts/verify-m003-s01.sh
pnpm run verify:m010:s05
```

`verify:m010:s05` 会检查现有 DSLogic 支持说明：macOS + `dsview-cli` 是唯一 `live-proven` 的 host path，而且只有经典 DSLogic Plus 变体会在这条路径上被视为 ready。Linux 和 Windows 仍属于 `readiness-modeled` 的后续路径，应保留真实 diagnostics。

贡献说明请看：

- `CONTRIBUTING.md`
- `CONTRIBUTING.zh-CN.md`
- `.github/workflows/ci.yml`
