# dsh-vibecoding-preflight

为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 的 vibecoding 会话提供 Git 前置检查。

[English](README.md)

在让 AI 改代码之前，先确认它拿到的是最新代码、并且你自己的提交不会悄悄留在本地。这个插件在会话标题栏加了一个按钮，一键完成这件事。

## 功能

- **非 Git 项目置灰但仍可点击。** 会话打开时用 `git rev-parse --is-inside-work-tree` 检查会话目录；不在 Git 工作树内时按钮灰显并用 tooltip 说明原因。它保持可点击，点击、每 20 秒以及窗口重新获得焦点时都会重新检测，因此目录后来执行 `git init` 变成仓库后无需刷新页面即可恢复。
- **一次点击跑完前置检查**（当前分支及其上游）：
  - **两边一致** —— 本地与远程相同：只提示，不执行任何操作；
  - **远程领先** —— 自动 `git pull --ff-only`，随后把变更提交列表和 `git diff --stat` 作为跟进提示交给当前 AI，由它熟悉本次变更；
  - **本地领先** —— 列出领先的提交（hash、标题、作者、时间），在你点击「推送到远程」确认之前不做任何事；
  - **分叉 / 未配置上游 / fetch 失败** —— 说明原因，绝不执行破坏性 Git 命令。
- **未提交改动** 会作为提示展示，不阻塞检查；`--ff-only` 失败时原样展示 git 的报错。

## 使用

1. 打开一个 Git 项目的会话。
2. 点击会话标题栏的 **Git 检查** 按钮。
3. 根据结果卡处理：
   - 远程领先：等待拉取完成，AI 会新开一轮回复总结新提交；
   - 本地领先：确认提交列表后点击 **推送到远程** 或 **取消**；
   - 已是最新：无需其它操作。

## 配置

`cordis.patch.yml` 中的行配置会直接传给 Host 半边，也可以在你的 profile patch 里覆盖：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `autoPull` | `true` | 远程严格领先时是否自动拉取；为 `false` 时面板提供「拉取」按钮。 |
| `aiFamiliarize` | `true` | 拉取后是否让当前 AI 跟进并熟悉变更。 |
| `commitListLimit` | `20` | 每个方向最多列出的提交数。 |
| `timeoutMs` | `120000` | 单次 git 命令超时。 |
| `aiPromptTemplate` | `''` | 可选的跟进提示模板，支持 `{branch}`、`{upstream}`、`{count}`、`{commits}`、`{stat}`、`{summary}`。 |

## 实现方式

- **Host 半边**（`index.js`）在 `ctx.webServer` 上注册 `/vibecoding-preflight/api/` 下的四个同源 JSON 路由（`status`、`check`、`pull`、`push`）。它通过 `ctx.sessions` / `ctx.workingDirectory` 解析会话工作目录，用参数数组方式执行 `git`（不拼接 shell 字符串），输出经临时文件捕获，且不使用任何破坏性命令（仅有的写操作是 `git fetch --prune`、`git pull --ff-only` 和用户确认后的 `git push <remote> HEAD:<branch>`）。
- **Client 半边**（`client.js`）向 `conversation.session.header.actions` 注册一个胶囊按钮，把结果卡片 portal 到 `document.body`（标题栏会裁剪溢出），所有文案走 Client locale 服务（`en` / `zh`）。
- DSH 的 `ctx.remote` 命名空间在构建期固定，运行时插件无法新增，因此插件自身的 Client→Host 调用走同源路由。

## 限制

- 只处理当前分支与其配置的上游；多远程、分离 HEAD、worktree 等情况只报告不处理。
- 拉取固定使用 `git pull --ff-only`。若远程改动与本地改动/未跟踪文件冲突，git 会中止拉取，面板原样展示原因：插件不会发起 merge，因此不会留下冲突标记、冲突索引或半途的合并状态。提交或暂存后重新检查即可。
- 网络访问依赖系统 `git` 配置（凭据、代理、SSH key）。fetch/push 失败会原样展示；插件不存储也不索取任何凭据。
- 「AI 熟悉变更」是一条用户可见的跟进消息：它会进入会话日志，并可能需要一点时间让 AI 阅读 diff。
- 需要提供 `webServer`、`sessions`、`agents`、`workingDirectory` 服务的 DSH 版本（Web GUI / 桌面版）。

## 安装

把包目录作为 bundle 安装到 DSH profile（**设置 → 插件 → 添加插件** 选择本地目录，或使用 `dsh` 插件工具），必要时启用 `vibecoding-preflight` 行。

## 开发

bundle 是纯 JavaScript，无构建步骤：

```text
index.js            Host 半边（路由 + git 执行 + AI 跟进）
client.js           Client 半边（浏览器模块、插槽注册、面板 UI）
cordis.patch.yml    Loader 行
locale/en.json      插件管理器展示信息（英文）
locale/zh.json      插件管理器展示信息（中文）
docs/               需求分析、详情页、预览图
```

## 协议

[MIT](LICENSE)
