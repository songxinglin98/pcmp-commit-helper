# PCMP Commit Helper

VS Code 插件。分支名含 `PCMP` 时自动给提交信息加单号前缀；提供从基线分支创建分支并推送；**并通过 git 钩子覆盖命令行提交**。

## 两条提交路径，同一套前缀规则

| 提交方式 | 由谁加前缀 |
| --- | --- |
| 插件界面点「提交」 | 扩展宿主内部拼接（不经过钩子） |
| 命令行 `git commit` / 图形客户端 | `prepare-commit-msg` 钩子 |

两条路径的解析规则实现在 `webview-ui/src/pcmpPrefix.ts`（TS）和 `hooks/prepare-commit-msg`（shell），逻辑保持一致，各有测试覆盖。**必须同改**，改一处要同步另一处。

前缀形式 `<单号>: `，判定只看分支名：

| 当前分支 | 提交信息 | 结果 |
| --- | --- | --- |
| `dev/PCMP-123` | `修复登录` | `PCMP-123: 修复登录` |
| `feature/PCMP_456` | `修复登录` | `PCMP-456: 修复登录` |
| `feature/PCMP456` | `修复登录` | `PCMP-456: 修复登录` |
| `feature/PCMP-login` | `修复登录` | `feature/PCMP-login: 修复登录` |
| `dev` | `修复登录` | `修复登录` |

## 为什么用 `core.hooksPath` 而不是 simple-git-hooks

`simple-git-hooks` 的本质仍是往 `.git/hooks/` 写脚本，只是把安装挂在 `package.json` 的 `prepare` 上。在你这种多端 monorepo（rn55/rn62/rnweb/harmony72 各自是独立仓库）里有两个问题：

1. **每个仓库都要装一遍**，漏装就静默失效，且钩子不随仓库版本走，换台机器要重来
2. 它管理的是仓库本地钩子，**没有全局概念**

`core.hooksPath` 是 git 原生配置。插件点一次「全局安装」，写一次 `git config --global core.hooksPath`，此后**所有现存和新建的仓库立即生效，零配置**。实测确认：在配置了全局钩子的环境下新建仓库，仓库内 `git config --local core.hooksPath` 为空，提交照样加前缀。

插件提供两种安装范围：

- **全局安装**（推荐）：`~/.pcmp-git-hooks/`，对所有仓库生效
- **仅本仓库**：仓库根的 `.githooks/`，可以随仓库提交进版本控制，团队共享

安装前若检测到已存在的同名钩子，会备份为 `.bak` 并弹确认框；若你原本用 `core.hooksPath` 指向别的目录，会明确提示覆盖，不会静默废掉你那套钩子。

## 钩子的边界处理

这些都是实测踩出来的，不是设想：

- **merge / squash / template 直接跳过**。git 在这几种情况下给的信息是空的或是机器生成的，无条件拼前缀会产出 `PCMP-123:` 这种垃圾提交信息
- **空信息跳过**。交互式提交时 git 会调编辑器，此时信息文件是空的，加前缀会污染用户将要输入的内容
- **首行是 `#` 注释时跳过**（默认注释前缀）
- **幂等**。已带 `PCMP-123:` / `[PCMP-123]` / `PCMP-123 ` 前缀的信息原样返回，`amend` 反复提交不会叠成 `PCMP-123: PCMP-123: ...`
- **歧义分支名退化为完整分支名**。只解析两种明确形态：`PCMP-123`（`-`/`_` 分隔）和 `PCMP123`（直接接数字）。像 `dev/PCMP.1+2-77`、`dev/PCMP(9)-8` 这种关键字后跟 `.` `(` 的名字刻意不解析——里面那串数字含义不明，猜错会把提交挂到**错误的单号**上，代价高于不加前缀
- **正则元字符按字面处理**。分支名里的 `.` `+` `(` `)` `[` `]` 是正则/glob 元字符，用 awk 逐字符比较而不是拼正则，`dev/PCMP-8(2)` 能正确解析出 `PCMP-8`
- **钩子退出码恒为 0**。前缀是锦上添花，不应该阻断任何一次提交

关键字可用环境变量 `PCMP_HOOK_KEYWORD` 覆盖，默认 `PCMP`。

## 功能

### 1. 提交信息自动加 PCMP 前缀

见上面的规则表。前缀在界面上有**实时预览**，提交前能看到最终结果。

### 2. 创建分支并推送

输入分支名 → 选基线（默认 `master`，可配置）→ 一次完成 `switch -c` + `push --set-upstream`。
基线列表来自 `refs/remotes`，所以 `origin/dev`、`to_dev/dev`、gerrit 的 `to_master` 这类多远端命名都能选。

## 开发

```bash
npm install
npm --prefix webview-ui install

npm run build        # 构建 webview + 扩展
npm run typecheck    # 两端类型检查
npm test             # PCMP 规则单元测试（13 项）
npm run test:hook    # 钩子场景测试，跑真实 git（21 项）
```

在 VS Code 里按 F5（**运行扩展**配置）会开一个新的扩展宿主窗口，侧边栏出现 PCMP Commit 图标。

### webview 热更新

改 React 样式时不必每次重启扩展宿主。先起 dev server：

```bash
npm --prefix webview-ui run dev
```

再用 **运行扩展（webview 热更新）** 这个调试配置启动——它把 `PCMP_WEBVIEW_DEV_SERVER` 传给扩展，webview 改为从 Vite dev server 加载，改 React 代码即时生效。

注意 `acquireVsCodeApi` 在纯浏览器里不存在，`bridge.ts` 会降级为只打日志，所以 dev server 单独打开时界面能渲染但没有真实数据。

### 打包安装

```bash
npm run package      # 产出 .vsix
code --install-extension pcmp-commit-helper-0.0.1.vsix
```

## 结构

```
src/                     扩展宿主（Node 侧）
  extension.ts           激活、注册视图、监听 .git/HEAD 变化
  viewProvider.ts        消息处理与界面状态
  git/exec.ts            git 调用封装、分支名校验、基线列表
  git/repo.ts            仓库状态读取
  git/actions.ts         提交、建分支并推送
  git/hookInstaller.ts   钩子的安装/卸载/状态检测
  webview/html.ts        webview HTML 与 CSP
hooks/
  prepare-commit-msg     命令行提交用的钩子（插件打包时一并分发）
webview-ui/              React + Vite 界面
  src/pcmpPrefix.ts      前缀规则（与 shell 版并行维护）
  src/protocol.ts        两端消息协议
  src/App.tsx            界面
tests/
  pcmpPrefix.test.ts     规则单元测试
  hook.test.sh           钩子场景测试（真实 git）
```

## 已知约束

- **Node 版本**：Vite 7 要求 Node 20.19+ 或 22.12+。当前环境是 20.17，构建能跑但会打版本警告，建议升级。
- **Vite 产物形态**：webview 加载的是 `vscode-webview://` 协议，不是 http。因此 `vite.config.ts` 里 `base: './'`、`cssCodeSplit: false`、`inlineDynamicImports: true` 三项不能去掉，否则 webview 白屏。产物文件名固定为 `assets/index.js`（不带 hash），扩展侧按固定路径引用。
- **扩展产物必须是 `.cjs`**：根 `package.json` 是 `"type": "module"`（为了共享 webview 的 ESM 源码），若产物用 `.js`，VS Code 会把 CommonJS 产物当 ESM 加载而启动失败。
- **`for-each-ref` 的 `--format` 不解析 `%x09`**：必须用真实的制表符字面量，否则分支名会被污染成 `dev/PCMP-1%x092026-09-20T...`。

## 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `pcmpCommitHelper.branchKeyword` | `PCMP` | 分支名出现该关键字才加前缀，忽略大小写 |
| `pcmpCommitHelper.defaultBase` | 空 | 新建分支的默认基线，留空自动选 `master` / `main` |

## 验证情况

已验证：

- `npm run build`、`npm run typecheck` 通过
- 规则单元测试 13 项通过；钩子场景测试 21 项通过（含 merge、amend、空信息、歧义分支名、正则元字符）
- **端到端**：隔离 HOME 与 git config，模拟安装后跑真实 `git commit`，确认命令行提交自动加前缀、amend 不叠前缀、非 PCMP 分支不受影响、新建仓库零配置生效、单仓库模式不污染全局配置
- 打包产物 `dist/extension.cjs` 能被加载并跑完 `activate()`
- webview HTML 生成正确：引用 `index.js` / `style.css`，脚本带 nonce，无绝对路径

未验证：**界面未在真实 VS Code 里跑过**。需要你按 F5 走一遍，重点看 webview 是否正常渲染、点提交与安装钩子后提示是否正常。

