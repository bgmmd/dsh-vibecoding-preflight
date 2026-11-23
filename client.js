/**
 * Client half of the `dsh-vibecoding-preflight` bundle.
 *
 * Registers one pill button in the conversation header actions band. The button
 * is muted while the Session directory is not a Git work tree, and clicking
 * it runs the preflight workflow against the Host routes:
 *
 * 1. `check` — fetch, compare, and (when the remote is ahead) pull;
 * 2. the Host asks the current Agent to review pulled commits;
 * 3. when the local branch is ahead, the panel lists the commits and the user
 *    confirms the push.
 *
 * The panel is portaled to `document.body` because the header clips horizontal
 * overflow. All copy goes through the Client locale service.
 *
 * @module dsh-vibecoding-preflight/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-vibecoding-preflight',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'vibecoding-preflight'
    const API = '/vibecoding-preflight/api'

    const en = {
      'button.label': 'Git preflight',
      'button.busy': 'Checking…',
      'button.tooltip': 'Check whether this project is a Git repository and whether the local branch matches its remote.',
      'button.disabled': 'This project is not a Git repository. Click to check again.',
      'button.unavailable': 'The Git preflight check is unavailable right now.',
      'button.state.upToDate': 'Up to date',
      'button.state.ahead': 'Push pending',
      'button.state.behind': 'Updates available',
      'panel.title': 'Git preflight',
      'panel.branch': 'Branch',
      'panel.upstream': 'Upstream',
      'panel.ahead': 'Ahead',
      'panel.behind': 'Behind',
      'panel.dirty': '{n} uncommitted change(s)',
      'panel.checking': 'Comparing the local branch with its upstream…',
      'panel.pulling': 'Pulling the remote commits…',
      'panel.pushing': 'Pushing the local commits…',
      'panel.loading': 'Reading the Git status…',
      'panel.upToDate': 'Local and remote are identical. You are on the latest code.',
      'panel.pulled': 'Pulled {n} commit(s) from the remote.',
      'panel.pulledNoCommits': 'The remote had no new commits after all.',
      'panel.remoteAhead': 'The remote is {n} commit(s) ahead. Pull to update the local branch.',
      'panel.pushRequired': 'The local branch is {n} commit(s) ahead. Confirm to push them to the remote.',
      'panel.pushed': 'Pushed {n} commit(s) to the remote.',
      'panel.diverged': 'Local and remote have diverged ({ahead} local, {behind} remote). Rebase or merge manually, then check again.',
      'panel.noUpstream': 'The current branch has no upstream, so there is nothing to compare. Nothing was changed; set one with git branch --set-upstream-to=<remote>/<branch>.',
      'panel.notRepo': 'The session directory is not inside a Git repository.',
      'panel.detached': 'HEAD is detached. Check out a branch to use the preflight; nothing was changed.',
      'panel.error.fetch': 'Could not fetch from the remote. Check the network, your credentials, or that the remote exists, then try again.',
      'panel.error.pull': 'The pull did not complete. Commit or stash local changes, resolve any divergence, then check again.',
      'panel.error.push': 'The push did not complete. Check your credentials, or pull first if the remote moved on.',
      'panel.commits': 'Commits',
      'panel.remoteCommits': 'Remote commits',
      'panel.files': 'Changed files',
      'panel.more': '{n} more not shown',
      'panel.aiQueued': 'The AI is reviewing these changes in a new turn.',
      'panel.aiNotQueued': 'The AI review was not started because the session is not live.',
      'panel.refresh': 'Check again',
      'panel.pull': 'Pull',
      'panel.push': 'Push to remote',
      'panel.cancel': 'Cancel',
      'panel.close': 'Close',
      'error.sessionNotFound': 'The session could not be resolved. Reopen it and try again.',
      'error.generic': 'The preflight request was refused.',
      'error.network': 'Could not reach the DeepSeek Harness host. Check that the app is still running, then reopen the panel.',
      'error.notFound': 'The preflight Host routes are not registered. Reload the app or reinstall the plugin.',
    }

    const zh = {
      'button.label': 'Git 检查',
      'button.busy': '检查中…',
      'button.tooltip': '检查当前项目是否为 Git 仓库，以及本地分支与远程分支是否一致。',
      'button.disabled': '当前项目不是 Git 仓库，点击可重新检测。',
      'button.unavailable': 'Git 前置检查当前不可用。',
      'button.state.upToDate': '已同步',
      'button.state.ahead': '待推送',
      'button.state.behind': '有更新',
      'panel.title': 'Git 前置检查',
      'panel.branch': '分支',
      'panel.upstream': '上游',
      'panel.ahead': '领先',
      'panel.behind': '落后',
      'panel.dirty': '{n} 个未提交改动',
      'panel.checking': '正在比较本地分支与上游分支…',
      'panel.pulling': '正在拉取远程提交…',
      'panel.pushing': '正在推送本地提交…',
      'panel.loading': '正在读取 Git 状态…',
      'panel.upToDate': '本地与远程一致，已是最新代码。',
      'panel.pulled': '已从远程拉取 {n} 个提交。',
      'panel.pulledNoCommits': '远程没有新的提交，无需更新。',
      'panel.remoteAhead': '远程领先 {n} 个提交，点击「拉取」更新本地。',
      'panel.pushRequired': '本地领先 {n} 个提交，确认后将推送到远程。',
      'panel.pushed': '已推送 {n} 个提交到远程。',
      'panel.diverged': '本地与远程已分叉（本地领先 {ahead}，远程领先 {behind}）。请手动 rebase 或 merge 后重新检查。',
      'panel.noUpstream': '当前分支未配置远程跟踪分支，无法比较。未执行任何 Git 操作；可用 git branch --set-upstream-to=<remote>/<branch> 建立跟踪关系。',
      'panel.notRepo': '当前会话目录不在 Git 仓库中。',
      'panel.detached': '当前处于分离 HEAD 状态，请切换到分支后再检查；未执行任何 Git 操作。',
      'panel.error.fetch': '无法从远程拉取信息。请检查网络、凭据或远程仓库是否存在，然后重试。',
      'panel.error.pull': '拉取未完成。请先提交或暂存本地改动、处理分叉后重新检查。',
      'panel.error.push': '推送未完成。请检查凭据；若远程已有新提交，请先拉取。',
      'panel.commits': '提交列表',
      'panel.remoteCommits': '远程提交',
      'panel.files': '改动文件',
      'panel.more': '另有 {n} 条未显示',
      'panel.aiQueued': 'AI 正在新的一轮回复中熟悉这些变更。',
      'panel.aiNotQueued': '会话未处于活跃状态，AI 未能自动熟悉变更。',
      'panel.refresh': '重新检查',
      'panel.pull': '拉取',
      'panel.push': '推送到远程',
      'panel.cancel': '取消',
      'panel.close': '关闭',
      'error.sessionNotFound': '无法解析当前会话，请重新打开会话后再试。',
      'error.generic': '前置检查请求被拒绝。',
      'error.network': '无法连接 DeepSeek Harness 宿主进程。请确认应用仍在运行，然后重新打开面板。',
      'error.notFound': '前置检查的 Host 路由未注册，请刷新页面或重新安装插件。',
    }

    /** Flat dictionary lookup with `{token}` interpolation. */
    function fill(template, params) {
      if (template === undefined || template === null) return ''
      return String(template).replace(/\{([a-zA-Z]+)\}/g, (match, key) => (
        params !== undefined && Object.prototype.hasOwnProperty.call(params, key)
          ? String(params[key])
          : match
      ))
    }

    /** Owner-provided props plus the injected session/translation face. */
    function PreflightAction(props) {
      const sessionId = props.sessionId
      const t = props.t
      const subscribe = props.subscribe
      const getSnapshot = props.getSnapshot

      // Re-render when the language preference changes; the bound translator
      // keeps its identity and reads the live dictionaries.
      React.useSyncExternalStore(subscribe, getSnapshot)

      const [status, setStatus] = React.useState({ phase: 'loading' })
      const [panel, setPanel] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)

      const call = React.useCallback(async (action) => {
        const response = await fetch(`${API}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, locale: currentLocaleTag() }),
          credentials: 'same-origin',
        })
        if (response.status === 404) return { ok: false, error: 'routes-missing' }
        if (!response.ok) return { ok: false, error: `http-${response.status}` }
        return await response.json()
      }, [sessionId])

      const currentLocaleTag = () => {
        try {
          const snapshot = getSnapshot()
          const id = snapshot?.active ?? ''
          return String(id).toLowerCase().startsWith('zh') ? 'zh' : 'en'
        } catch {
          return 'en'
        }
      }

      const loadStatus = React.useCallback(async () => {
        try {
          const result = await call('status')
          setStatus({ phase: 'ready', result })
        } catch {
          setStatus({ phase: 'ready', result: { ok: false, error: 'network' } })
        }
      }, [call])

      React.useEffect(() => {
        let cancelled = false
        loadStatus().then(() => { if (cancelled) return })
        return () => { cancelled = true }
      }, [loadStatus])

      const statusReady = status.phase === 'ready'
      const notRepo = statusReady && status.result?.isRepo === false
      const statusFailed = statusReady && status.result?.ok === false
      // A non-repository Session keeps the muted style but stays operable: a
      // directory can turn into a repository (`git init`) while the Session
      // stays open, so a click must re-check instead of staying grey forever.
      const muted = !statusReady || notRepo || statusFailed
      const wasMutedRef = React.useRef(true)

      // While the preflight is unavailable, poll the cheap status route and
      // re-read it whenever the window regains focus, so the button recovers
      // without a page reload.
      React.useEffect(() => {
        if (!muted) return undefined
        const timer = window.setInterval(() => { loadStatus() }, 20000)
        return () => window.clearInterval(timer)
      }, [muted, loadStatus])

      React.useEffect(() => {
        const refresh = () => { loadStatus() }
        const onVisibility = () => {
          if (document.visibilityState === 'visible') refresh()
        }
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.removeEventListener('focus', refresh)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [loadStatus])

      const run = React.useCallback(async (action) => {
        setBusy(true)
        setPanel({ state: 'checking', action })
        try {
          const result = await call(action)
          setPanel({ ...result, state: result?.state ?? (result?.ok ? 'unknown' : 'error') })
        } catch {
          setPanel({ ok: false, state: 'error', phase: 'network' })
        } finally {
          setBusy(false)
        }
      }, [call])

      const openPanel = React.useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (rect !== undefined && rect !== null) {
          const width = Math.max(240, Math.min(392, window.innerWidth - 24))
          const right = Math.max(12, window.innerWidth - rect.right)
          const left = Math.max(12, Math.min(window.innerWidth - right - width, window.innerWidth - width - 12))
          setAnchor({ top: rect.bottom + 8, left, width })
        }
        setOpen(true)
        // Every opening re-runs the workflow so the panel never shows a stale
        // result after work done in a terminal or IDE.
        run('check')
      }, [run])

      const closePanel = React.useCallback(() => {
        setOpen(false)
        const trigger = buttonRef.current
        if (trigger !== undefined && trigger !== null) trigger.focus()
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          closePanel()
        }
        window.addEventListener('keydown', onKeyDown)
        panelRef.current?.focus()
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [open, closePanel])

      // If the poll discovers a repository while the panel still shows the
      // "not a repository" result, run the workflow instead of leaving stale
      // copy on screen.
      React.useEffect(() => {
        const repoNow = statusReady && status.result?.ok === true && status.result.isRepo === true
        if (repoNow && wasMutedRef.current && open && panel?.state === 'not-repo') run('check')
        if (statusReady) wasMutedRef.current = !repoNow
      }, [statusReady, status.result, open, panel, run])

      // The button advertises the last known result without opening the panel.
      const summaryState = panel?.state
      const buttonState = busy || summaryState === 'checking'
        ? 'busy'
        : summaryState === 'up-to-date' || summaryState === 'pulled' || summaryState === 'pushed'
          ? 'ok'
          : summaryState === 'push-required'
            ? 'ahead'
            : summaryState === 'remote-ahead'
              ? 'behind'
              : summaryState === 'error' || summaryState === 'diverged' || summaryState === 'no-upstream'
                ? 'warn'
                : 'idle'
      const stateLabel = buttonState === 'busy'
        ? t('button.busy')
        : buttonState === 'ok'
          ? t('button.state.upToDate')
          : buttonState === 'ahead'
            ? t('button.state.ahead')
            : buttonState === 'behind'
              ? t('button.state.behind')
              : t('button.label')

      const tooltip = status.phase === 'loading'
        ? t('panel.loading')
        : notRepo
          ? t('button.disabled')
          : statusFailed
            ? t('button.unavailable')
            : t('button.tooltip')

      const children = [
        anchor !== undefined && open
          ? ReactDOM.createPortal(h(PanelView, {
            key: 'panel',
            anchor,
            panel,
            status: status.result,
            busy,
            t,
            panelRef,
            onClose: closePanel,
            onRefresh: () => run('check'),
            onPull: () => run('pull'),
            onPush: () => run('push'),
          }), document.body)
          : null,
        h('button', {
          key: 'button',
          ref: buttonRef,
          type: 'button',
          className: 'vbp-btn',
          'data-state': buttonState,
          'data-muted': muted ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-busy': busy,
          disabled: busy,
          title: tooltip,
          'aria-label': `${t('button.label')} — ${tooltip}`,
          onClick: openPanel,
        },
        h(Glyph, { state: buttonState }),
        h('span', { className: 'vbp-btn-label' }, stateLabel)),
      ]

      return h(React.Fragment, null, children)
    }

    /** State glyph: branch mark, spinner, check, arrows, or warning. */
    function Glyph(props) {
      if (props.state === 'busy') return h('span', { className: 'vbp-spinner', 'aria-hidden': true })
      if (props.state === 'ok') {
        return h('svg', { className: 'vbp-glyph', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M3 8.5 6.2 11.7 13 5', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (props.state === 'ahead') {
        return h('svg', { className: 'vbp-glyph', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M8 13V3M4 7l4-4 4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (props.state === 'behind') {
        return h('svg', { className: 'vbp-glyph', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M8 3v10M4 9l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (props.state === 'warn') {
        return h('svg', { className: 'vbp-glyph', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M8 2.5 14.5 13.5H1.5L8 2.5ZM8 6.5v3.2M8 11.6v.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      return h('svg', { className: 'vbp-glyph', viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('circle', { cx: 4.5, cy: 4, r: 1.9, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 4.5, cy: 12, r: 1.9, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 11.5, cy: 7, r: 1.9, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M4.5 6v4M6.4 7h3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    /** Floating result card; portaled because the header clips overflow. */
    function PanelView(props) {
      const { anchor, panel, status, busy, t, panelRef, onClose, onRefresh, onPull, onPush } = props
      const state = panel?.state ?? 'loading'
      const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 160))
      const maxHeight = Math.max(140, window.innerHeight - top - 16)
      const close = () => { if (!busy) onClose() }

      return h(React.Fragment, null,
        h('div', {
          className: 'vbp-backdrop',
          onClick: close,
          'aria-hidden': true,
        }),
        h('div', {
          className: 'vbp-panel',
          ref: panelRef,
          tabIndex: -1,
          style: { top, left: anchor.left, width: anchor.width, maxHeight },
          role: 'dialog',
          'aria-label': t('panel.title'),
        },
          h('div', { className: 'vbp-panel-head' },
            h('span', { className: 'vbp-panel-title' },
              h('span', { className: 'vbp-panel-title-dot', 'data-state': state }),
              t('panel.title')),
            h('button', {
              type: 'button',
              className: 'vbp-icon-btn',
              title: t('panel.close'),
              'aria-label': t('panel.close'),
              disabled: busy,
              onClick: onClose,
            }, '×')),
          h(Meta, { t, status, panel }),
          h('div', { className: 'vbp-panel-body', 'aria-live': 'polite' }, h(Body, { t, state, panel, busy, status })),
          h(Dirty, { t, panel, status }),
          h('div', { className: 'vbp-panel-foot' },
            h('button', {
              type: 'button',
              className: 'vbp-btn-ghost',
              disabled: busy,
              onClick: onRefresh,
            }, t('panel.refresh')),
            state === 'remote-ahead'
              ? h('button', { type: 'button', className: 'vbp-btn-primary', disabled: busy, onClick: onPull }, t('panel.pull'))
              : null,
            state === 'push-required'
              ? h(React.Fragment, null,
                h('button', { type: 'button', className: 'vbp-btn-ghost', disabled: busy, onClick: onClose }, t('panel.cancel')),
                h('button', { type: 'button', className: 'vbp-btn-primary', disabled: busy, onClick: onPush }, t('panel.push')))
              : null)))
    }

    /** Branch/upstream chips shown above every result body. */
    function Meta(props) {
      const { t, status, panel } = props
      const source = panel !== undefined && panel !== null && panel.ok === true
        ? panel
        : status !== undefined && status !== null
          ? status
          : undefined
      if (source === undefined || source.isRepo !== true) return null
      const rows = []
      if (typeof source.branch === 'string' && source.branch !== '') {
        rows.push(h('span', { key: 'branch', className: 'vbp-chip' },
          h('span', { className: 'vbp-chip-label' }, t('panel.branch')),
          h('span', { className: 'vbp-chip-value' }, source.branch)))
      }
      if (typeof source.upstream === 'string' && source.upstream !== '') {
        rows.push(h('span', { key: 'upstream', className: 'vbp-chip' },
          h('span', { className: 'vbp-chip-label' }, t('panel.upstream')),
          h('span', { className: 'vbp-chip-value' }, source.upstream)))
      }
      if (source.detached === true) {
        rows.push(h('span', { key: 'detached', className: 'vbp-chip vbp-chip-warn' },
          h('span', { className: 'vbp-chip-value' }, 'detached HEAD')))
      }
      if (Number.isFinite(source.ahead) && source.ahead > 0) {
        rows.push(h('span', { key: 'ahead', className: 'vbp-chip vbp-chip-warn' },
          h('span', { className: 'vbp-chip-label' }, t('panel.ahead')),
          h('span', { className: 'vbp-chip-value' }, String(source.ahead))))
      }
      if (Number.isFinite(source.behind) && source.behind > 0) {
        rows.push(h('span', { key: 'behind', className: 'vbp-chip vbp-chip-warn' },
          h('span', { className: 'vbp-chip-label' }, t('panel.behind')),
          h('span', { className: 'vbp-chip-value' }, String(source.behind))))
      }
      if (rows.length === 0) return null
      return h('div', { className: 'vbp-meta' }, rows)
    }

    /** Uncommitted-changes hint shared by every repository-backed result. */
    function Dirty(props) {
      const { t, panel, status } = props
      const source = panel !== undefined && panel !== null && panel.ok === true ? panel : status
      if (!Number.isFinite(source?.dirty) || source.dirty <= 0) return null
      return h('div', { className: 'vbp-note vbp-dirty' }, fill(t('panel.dirty'), { n: source.dirty }))
    }

    /** One text block with an optional heading. */
    function Section(props) {
      return h('div', { className: 'vbp-section' },
        h('div', { className: 'vbp-section-title' }, props.title),
        h('div', { className: props.mono === true ? 'vbp-mono' : 'vbp-text' }, props.children))
    }

    /** Commit rows; `max` bounds a long list and `total` labels the remainder. */
    function CommitList(props) {
      const commits = Array.isArray(props.commits) ? props.commits : []
      if (commits.length === 0) return null
      const shown = commits.slice(0, props.max ?? commits.length)
      const total = Number.isFinite(props.total) ? props.total : commits.length
      const hidden = Math.max(0, total - shown.length)
      return h(React.Fragment, null,
        h('div', { className: 'vbp-commits' }, shown.map((commit, index) => h('div', {
          key: `${commit.hash ?? ''}-${index}`,
          className: 'vbp-commit',
        },
          h('span', { className: 'vbp-commit-hash' }, commit.hash ?? ''),
          h('span', { className: 'vbp-commit-subject', title: commit.subject ?? '' }, commit.subject ?? ''),
          h('span', { className: 'vbp-commit-meta' },
            [commit.author, commit.date].filter((value) => value !== undefined && value !== '').join(' · ') || '')))),
        hidden > 0 ? h('div', { className: 'vbp-note' }, fill(t('panel.more'), { n: hidden })) : null)
    }

    /** State-specific body content. */
    function Body(props) {
      const { t, state, panel, busy, status } = props
      const note = []
      const push = (key, node) => note.push(h('div', { key, className: 'vbp-node' }, node))

      if (state === 'loading') {
        return h('div', { className: 'vbp-row' }, h('span', { className: 'vbp-spinner' }), h('span', { className: 'vbp-text' }, t('panel.checking')))
      }
      if (state === 'checking') {
        const action = panel?.action
        const text = action === 'pull' ? 'panel.pulling' : action === 'push' ? 'panel.pushing' : 'panel.checking'
        return h('div', { className: 'vbp-row' }, h('span', { className: 'vbp-spinner' }), h('span', { className: 'vbp-text' }, t(text)))
      }
      if (state === 'error') {
        const key = panel?.phase === 'fetch'
          ? 'panel.error.fetch'
          : panel?.phase === 'pull'
            ? 'panel.error.pull'
            : panel?.phase === 'push'
              ? 'panel.error.push'
              : panel?.phase === 'network'
                ? 'error.network'
                : panel?.error === 'session-not-found'
                  ? 'error.sessionNotFound'
                  : panel?.error === 'routes-missing'
                    ? 'error.notFound'
                    : panel?.error === 'network'
                      ? 'error.network'
                      : 'error.generic'
        push('error', h('div', { className: 'vbp-alert-error' }, t(key)))
        if (typeof panel?.detail === 'string' && panel.detail !== '') {
          push('detail', h('pre', { className: 'vbp-pre' }, panel.detail))
        }
        return note
      }
      if (state === 'not-repo') {
        push('text', h('div', { className: 'vbp-alert' }, t('panel.notRepo')))
        if (typeof panel?.cwd === 'string') push('cwd', h('pre', { className: 'vbp-pre' }, panel.cwd))
        return note
      }
      if (state === 'no-upstream') {
        push('text', h('div', { className: 'vbp-alert' }, t(panel?.detached === true ? 'panel.detached' : 'panel.noUpstream')))
        return note
      }
      if (state === 'up-to-date') {
        push('text', h('div', { className: 'vbp-good' }, t('panel.upToDate')))
        return note
      }
      if (state === 'diverged') {
        push('text', h('div', { className: 'vbp-alert' }, fill(t('panel.diverged'), { ahead: panel?.ahead ?? 0, behind: panel?.behind ?? 0 })))
        if (Array.isArray(panel?.commits) && panel.commits.length > 0) {
          push('commits', h(React.Fragment, null,
            h('div', { className: 'vbp-section-title' }, t('panel.commits')),
            h(CommitList, { commits: panel.commits, max: 10, total: panel?.ahead })))
        }
        if (Array.isArray(panel?.remoteCommits) && panel.remoteCommits.length > 0) {
          push('remote-commits', h(React.Fragment, null,
            h('div', { className: 'vbp-section-title' }, t('panel.remoteCommits')),
            h(CommitList, { commits: panel.remoteCommits, max: 10, total: panel?.behind })))
        }
        return note
      }
      if (state === 'remote-ahead') {
        push('text', h('div', { className: 'vbp-alert' }, fill(t('panel.remoteAhead'), { n: panel?.behind ?? 0 })))
        if (Array.isArray(panel?.commits) && panel.commits.length > 0) {
          push('commits', h(CommitList, { commits: panel.commits, max: 10, total: panel?.behind }))
        }
        return note
      }
      if (state === 'push-required') {
        push('text', h('div', { className: 'vbp-alert' }, fill(t('panel.pushRequired'), { n: panel?.ahead ?? 0 })))
        push('commits', h(CommitList, { commits: panel?.commits ?? [], max: 20, total: panel?.ahead }))
        return note
      }
      if (state === 'pushed') {
        const count = Number.isFinite(panel?.pushedCount) ? panel.pushedCount : (panel?.commits?.length ?? panel?.ahead ?? 0)
        push('text', h('div', { className: 'vbp-good' }, fill(t('panel.pushed'), { n: count })))
        if (Array.isArray(panel?.commits) && panel.commits.length > 0) push('commits', h(CommitList, { commits: panel.commits, max: 20, total: count }))
        return note
      }
      if (state === 'pulled') {
        const count = Number.isFinite(panel?.pulledCount) ? panel.pulledCount : (Array.isArray(panel?.commits) ? panel.commits.length : 0)
        push('text', h('div', { className: 'vbp-good' }, count > 0 ? fill(t('panel.pulled'), { n: count }) : t('panel.pulledNoCommits')))
        if (Array.isArray(panel?.commits) && panel.commits.length > 0) push('commits', h(CommitList, { commits: panel.commits, max: 20, total: count }))
        if (Array.isArray(panel?.files) && panel.files.length > 0) {
          push('files', h(Section, { title: t('panel.files'), mono: true }, panel.files.slice(0, 12).join('\n')))
        }
        const ai = panel?.ai
        if (ai !== undefined && ai !== null && ai.enabled !== false) {
          push('ai', h('div', { className: ai.queued === true ? 'vbp-note' : 'vbp-alert' },
            ai.queued === true ? t('panel.aiQueued') : t('panel.aiNotQueued')))
        }
        return note
      }
      push('text', h('div', { className: 'vbp-text' }, t('panel.loading')))
      return note
    }

    const CSS = `
.vbp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1;
  font-family: inherit;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
  white-space: nowrap;
}
.vbp-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.vbp-btn[data-muted="true"] {
  color: var(--dsw-alias-label-tertiary);
  opacity: .7;
}
.vbp-btn[data-muted="true"]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  opacity: .85;
}
.vbp-btn:disabled {
  cursor: not-allowed;
  opacity: .6;
}
.vbp-btn[data-state="ok"] { color: var(--dsw-alias-state-success-primary); }
.vbp-btn[data-state="ahead"] { color: var(--dsw-alias-state-warn-primary); }
.vbp-btn[data-state="behind"] { color: var(--dsw-alias-brand-primary); }
.vbp-btn[data-state="warn"] { color: var(--dsw-alias-state-warn-primary); }
.vbp-btn-label { overflow: hidden; text-overflow: ellipsis; }
.vbp-glyph { display: block; flex: none; }
.vbp-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.6px solid var(--dsw-alias-border-l3);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: vbp-spin .8s linear infinite;
  display: inline-block;
  flex: none;
}
@keyframes vbp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .vbp-spinner { animation-duration: 2.4s; }
}
@container (max-width: 560px) {
  .vbp-btn-label { display: none; }
  .vbp-btn { padding: 0 7px; }
}
.vbp-backdrop { position: fixed; inset: 0; z-index: 90; }
.vbp-panel {
  position: fixed;
  z-index: 100;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent);
  padding: 12px;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  line-height: 1.55;
  outline: none;
}
.vbp-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.vbp-panel-title { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
.vbp-panel-title-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }
.vbp-panel-title-dot[data-state="ok"], .vbp-panel-title-dot[data-state="up-to-date"], .vbp-panel-title-dot[data-state="pulled"], .vbp-panel-title-dot[data-state="pushed"] { background: var(--dsw-alias-state-success-primary); }
.vbp-panel-title-dot[data-state="error"], .vbp-panel-title-dot[data-state="diverged"] { background: var(--dsw-alias-state-error-primary); }
.vbp-panel-title-dot[data-state="no-upstream"], .vbp-panel-title-dot[data-state="push-required"], .vbp-panel-title-dot[data-state="remote-ahead"] { background: var(--dsw-alias-state-warn-primary); }
.vbp-icon-btn {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.vbp-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.vbp-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.vbp-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.vbp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 11.5px;
  max-width: 100%;
}
.vbp-chip-label { color: var(--dsw-alias-label-tertiary); }
.vbp-chip-value { color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vbp-chip-warn { border-color: var(--dsw-alias-state-warn-primary); }
.vbp-panel-body { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.vbp-row { display: flex; align-items: center; gap: 8px; }
.vbp-text { color: var(--dsw-alias-label-secondary); }
.vbp-good { color: var(--dsw-alias-state-success-primary); }
.vbp-alert { color: var(--dsw-alias-state-warn-primary); }
.vbp-alert-error { color: var(--dsw-alias-state-error-primary); }
.vbp-note { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.vbp-dirty { padding: 2px 0 0; }
.vbp-pre {
  margin: 0;
  padding: 8px;
  border-radius: 8px;
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow: auto;
}
.vbp-section-title { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
.vbp-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
}
.vbp-commits { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.vbp-commit { display: flex; align-items: baseline; gap: 8px; padding: 4px 8px; min-width: 0; }
.vbp-commit + .vbp-commit { border-top: 1px solid var(--dsw-alias-border-l1); }
.vbp-commit-hash { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-tertiary); flex: none; }
.vbp-commit-subject { color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.vbp-commit-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; flex: none; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vbp-panel-foot { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.vbp-btn-ghost, .vbp-btn-primary {
  height: 26px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.vbp-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.vbp-btn-primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
}
.vbp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.vbp-btn-ghost:disabled, .vbp-btn-primary:disabled { opacity: .55; cursor: not-allowed; }
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = NS
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, `${NS}: styles`)

        ctx.effect(() => ctx.locale.register(NS, 'en', en), `${NS}: en dictionary`)
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), `${NS}: zh dictionary`)

        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: NS,
          order: 30,
          locale: NS,
          inject: (sessionId) => ({
            sessionId,
            t: ctx.locale.bind(NS),
            subscribe: (listener) => ctx.locale.subscribe(listener),
            getSnapshot: () => ctx.locale.getSnapshot(),
          }),
        }, PreflightAction))
      },
    }
  },
})
