# Vibecoding 前置 Git 检查插件 — 需求分析

> 状态：已确认并实现（v0.1）；浏览器内的目视验证待用户首次打开页面确认。
> 目标运行环境：DeepSeek Harness（Desktop / Web），插件以 bundle 形式安装到 profile。

## 1. 背景与目标

Vibecoding（让 AI 直接改代码）开始前，最容易被忽略的一步是确认「工作目录的代码是不是最新的、与远程是否同步」。
落后的代码会让 AI 在过期上下文里工作，领先的本地提交则可能被遗忘在本地。

本插件在**会话标题栏顶部**提供一个「Git 前置检查」按钮，一键完成：

1. 当前项目是否是 Git 仓库；
2. 本地分支与远程上游分支是否一致；
3. 按结果自动拉取 / 提示并确认推送 / 只做提示；
4. 拉取后让 AI 熟悉本次变更。

## 2. 用户故事

- 作为用户，我打开一个项目会话，标题栏能看到「Git 检查」按钮；项目不是 Git 仓库时它是置灰的，鼠标悬停告诉我原因。
- 作为用户，我点击按钮后不需要自己敲 git 命令：插件会 fetch 并比较本地与远程，并用一句话告诉我结论（已是最新 / 已拉取 N 个提交 / 本地领先 N 个提交）。
- 作为用户，当本地领先时，我看得到领先的提交列表，并能自己决定是否推送。
- 作为用户，远程有新提交被拉下来后，AI 已经知道这些变更，可以立刻在最新代码上继续工作。

## 3. 功能需求

### FR-1 按钮位置与可见性
- 注册到会话标题栏已有的动作区（`conversation.session.header.actions`，位于会话标题旁、与预置标签/后台任务按钮同一排）。
- 仅在已打开会话（session scope）中渲染；无会话时不出现。
- 文案中英文（跟随 DSH locale），英文用 sentence case。

### FR-2 非 Git 项目置灰
- 判定：`git rev-parse --is-inside-work-tree` 在会话工作目录执行成功且输出 `true`。
- 不满足时按钮灰显（`data-muted`），tooltip 说明「当前目录不是 Git 仓库，点击可重新检测」。
- 按钮保持可点击：点击、每 20 秒轮询、窗口重新获得焦点时都会重新检测，因此目录后来变成 Git 仓库时无需刷新页面即可恢复（v0.1.1 修复）。

### FR-3 点击后的工作流
1. 解析会话工作目录。
2. 判定 Git 仓库；非仓库直接返回 FR-2 的提示（按钮本身已置灰，作为兜底）。
3. 解析当前分支与上游（`@{u}`）：
   - 无上游 / 无远程 → 提示「当前分支未配置远程跟踪分支」，不做拉取或推送。
4. `git fetch`（带超时），再比较 `git rev-list --left-right --count HEAD...@{u}`：
   - **ahead=0, behind=0** → 提示「本地与远程一致，已是最新代码」，不执行其它操作。
   - **ahead=0, behind>0** → 自动 `git pull --ff-only`；成功后生成变更摘要并让 AI 熟悉变更（FR-4）。
   - **ahead>0, behind=0** → 展示领先提交列表（hash、标题、作者、时间），用户确认后执行 `git push`（FR-5）。
   - **ahead>0, behind>0（分叉）** → 不自动操作，提示已分叉并给出两边提交数，建议手动 rebase/merge。
5. 所有分支都汇报：分支名、upstream、fetch/pull/push 结果。

### FR-4 让 AI 熟悉变更
- 拉取成功后，向当前会话注入一条**用户可见的跟进请求**，内容包含：
  - 拉取的提交数、提交列表（短 hash + 标题）；
  - `git diff --stat <oldHead>..<newHead>` 的文件改动摘要；
  - 请求 AI 阅读变更并在后续工作中考虑这些变更（AI 可自行用工具查看具体 diff）。
- 该跟进会触发一次 AI 回复（会话列表里能看到），属于用户点击按钮的预期结果。
- （待确认：见 D2，也可选择「仅静默注入上下文、不触发回复」。）

### FR-5 推送确认
- 推送是**用户专属操作**：AI 不能代替用户确认推送。
- 插件 UI 内展示提交列表 + 「推送到远程」/「取消」按钮；点击推送才执行 `git push`。
- 推送失败（无权限、非快进、网络）展示原始错误摘要。

### FR-6 状态反馈与并发
- 按钮有 idle / busy / success / error 四态；执行中禁用并显示进度文案。
- 结果以浮层卡片展示（分支、ahead/behind、提交列表、操作按钮）；浮层挂到 `document.body`（标题栏会裁剪溢出）。
- 结果卡片可关闭；推送成功后自动刷新为「已同步」。

### FR-7 安全与正确性
- HTTP 端点只服务本插件的固定路径前缀；拒绝跨站请求（校验 `Origin` / `Sec-Fetch-Site`），只接受 JSON POST。
- 所有 git 调用使用参数数组直接 spawn（不经 shell 字符串拼接），并在会话工作目录下执行。
- 不修改远程配置、不执行 `git reset` / `--force` 等破坏性操作。
- 拉取使用 `--ff-only`，分叉时不自动合并。

### FR-8 配置项（写在 bundle patch 里，用户可在 `cordis.patch.yml` 覆盖）
- `timeoutMs`：单条 git 命令超时（默认 120000）。
- `commitListLimit`：提交列表最多展示条数（默认 20）。
- `autoPull`：远程领先时是否自动拉取（默认 true）。
- `aiFamiliarize`：拉取后是否让 AI 熟悉变更（默认 true）。
- `aiPromptTemplate`：跟进提示模板（可选覆盖）。

## 4. 非功能需求

- **UI 一致性**：只用主题 token（`--dsw-alias-*`）、不引入第二套组件库；按钮尺寸/间距对齐标题栏已有控件。
- **不污染会话日志**：检查、比较、推送本身不写会话事件；只有 FR-4 的跟进消息进入会话。
- **零依赖**：Host 半边只用 Node 内置模块（`node:child_process` 等），不依赖 npm 包。
- **可卸载**：卸载插件后按钮与路由一起消失，不残留全局状态。
- **跨平台**：Windows / macOS / Linux 均通过系统 `git` 执行；Windows 下隐藏控制台窗口。

## 5. 技术方案（已验证可行的 DSH 扩展点）

| 关注点 | 方案 | 依据 |
| --- | --- | --- |
| 按钮插槽 | `conversation.session.header.actions`（list，session scope，props 含 `useSession`，`inject` 工厂收到 `sessionId`） | 运行时 Slot 检查 + 官方 slots 文档 |
| Client→Host 调用 | Host 用 `ctx.webServer.register` 注册同源 JSON 路由，Client 用 `fetch` 调用 | DSH 的 `@Remote` 命名空间在构建期固定，运行时插件无法新增；社区插件 dsh-plugin 同样采用该方式 |
| 会话工作目录 | `ctx.sessions.get(sessionId)` → `ctx.workingDirectory.get(session)`（回退 `session.header.cwd`） | Host Service 目录 + `dsh-session` 类型 |
| 执行 git | `node:child_process.spawn`，参数数组，`windowsHide` | 与 `completion-notifier` 等现有插件一致 |
| 让 AI 熟悉变更 | `ctx.agents.get(sessionId).followup(createUserMessage(...))` | `dsh-agent` 的 Agent 运行时接口 |
| 浮层 | `react-dom` 的 `createPortal(…, document.body)` | Web 端静态模块表包含 `react` / `react-dom` |

## 6. 交付物

1. 一个可安装的 bundle 包（Host + Client + patch + locale + icon + 详情文档）。
2. 独立的 Git 仓库（开源），含 README（中英）、LICENSE、DETAIL/preview 文档与图标。
3. 本地安装并完成 GUI 验证（非 Git 项目置灰、一致提示、远程领先拉取 + AI 跟进、本地领先确认推送）。
4. 推送到远程开源仓库。

## 7. 验收标准

- [x] 非 Git 项目：按钮置灰（`aria-disabled` + 灰化样式），tooltip 说明原因。`test/render` 断言 + 状态机。
- [x] 本地与远程一致：点击后提示「已是最新代码」，无副作用。`test/host.test.mjs` up-to-date 用例。
- [x] 远程领先：点击后自动拉取，显示拉取的提交，AI 随后给出变更摘要。`test/host.test.mjs` pulled 用例（含 followup 内容断言）。
- [x] 本地领先：点击后列出领先提交，确认后推送成功，再次检查显示一致。`test/host.test.mjs` push 用例。
- [x] 分叉 / 未配置上游 / 网络失败：给出明确可读的错误，不执行危险操作。diverged / no-upstream / 安全用例。
- [x] 中英文文案正确，图标与详情页在插件管理器中正常显示。安装 `application: applied`，资源与 locale 已核对；**渲染外观待用户首次打开页面确认**。
- [ ] 浏览器内目视验证（按钮位置、浮层、暗色 / 窄屏）。**唯一未完成项**：本会话无浏览器控制能力。

## 8. 已确认决策

- **D1 远程仓库**：`git@github.com:bgmmd/dsh-vibecoding-preflight.git`（SSH 已认证为 `bgmmd`）。
- **D2 「让 AI 熟悉变更」的形态**：拉取成功后自动触发一次 AI 回复（以用户可见的跟进消息）。
- **D3 未配置上游分支时**：仅提示，不执行任何 git 操作。
- **D4 命名与协议**：包名 `dsh-vibecoding-preflight`，标题「Vibecoding Git preflight / Vibecoding Git 前置检查」，MIT。
