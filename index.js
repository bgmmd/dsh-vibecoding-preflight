/**
 * Host half of the `dsh-vibecoding-preflight` bundle.
 *
 * Vibecoding starts with a question that is easy to skip: is this project a
 * Git repository, and is the local branch in sync with its upstream? This half
 * answers that question for the Client button and performs the two actions the
 * user authorizes from it:
 *
 * - remote ahead  -> `git pull --ff-only`, then a follow-up prompt so the
 *   current Agent reviews the pulled commits;
 * - local ahead   -> a commit list the user must confirm before `git push`.
 *
 * The Client reaches these operations over same-origin JSON routes registered
 * on `ctx.webServer`; DSH builds its typed `ctx.remote` namespaces at build
 * time, so a runtime bundle cannot add one of its own. Every git call spawns
 * `git` with an argument array (never a shell string) inside the Session's
 * working directory, and only non-destructive arguments are used.
 *
 * @module dsh-vibecoding-preflight
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Same-origin JSON API namespaces owned by this plugin. */
const ROUTE_PREFIX = '/vibecoding-preflight/api'
/** Reject oversized request bodies early; every accepted body is tiny JSON. */
const MAX_BODY_BYTES = 64 * 1024
/** Cap for the human-readable `git diff --stat` summary returned to the Client. */
const MAX_STAT_CHARS = 4000
/** Cap for a captured git stderr/stdout string returned to the Client. */
const MAX_DETAIL_CHARS = 2000

/** Services this bundle needs before it activates. */
export const inject = ['webServer', 'sessions', 'agents', 'workingDirectory']

/** Defaults merged over the Loader row's `config`. */
const DEFAULTS = {
  /** Pull automatically when the remote is strictly ahead. */
  autoPull: true,
  /** Ask the current Agent to review the pulled commits. */
  aiFamiliarize: true,
  /** Maximum commits listed for one ahead/behind direction. */
  commitListLimit: 20,
  /** Timeout for one git invocation. */
  timeoutMs: 120000,
  /** Optional template overriding the follow-up prompt; `{summary}` is replaced. */
  aiPromptTemplate: '',
}

/**
 * Register the preflight routes.
 * @param ctx - the plugin context.
 * @param config - the Loader row config, merged over {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config)

  const mount = (action) => ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/${action}`,
      handler: (request, response) => serve(ctx, settings, action, request, response),
    }),
    `vibecoding-preflight: ${action} route`,
  )

  mount('status')
  mount('check')
  mount('pull')
  mount('push')
}

/**
 * Run one request end to end: admit it, resolve the Session, dispatch the
 * action, and write one JSON response. A thrown error becomes a protocol error
 * so a defect never leaves a hung browser request.
 */
async function serve(ctx, settings, action, request, response) {
  try {
    if (request.method !== 'POST') {
      return writeJson(response, 405, { ok: false, error: 'method-not-allowed' })
    }
    if (!isTrustedRequest(ctx, request)) {
      return writeJson(response, 403, { ok: false, error: 'forbidden' })
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return writeJson(response, 415, { ok: false, error: 'unsupported-media-type' })
    }

    const body = await readJsonBody(request)
    if (body === undefined || typeof body !== 'object' || body === null) {
      return writeJson(response, 400, { ok: false, error: 'invalid-body' })
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const cwd = resolveSessionDirectory(ctx, sessionId)
    if (cwd === undefined) {
      return writeJson(response, 200, { ok: false, error: 'session-not-found' })
    }

    const locale = body.locale === 'zh' ? 'zh' : 'en'
    const result = await dispatch(ctx, settings, action, { cwd, sessionId, locale })
    writeJson(response, 200, result)
  } catch (error) {
    writeJson(response, 500, { ok: false, error: 'internal-error', detail: describe(error) })
  }
}

/** Run one action against the resolved working directory. */
async function dispatch(ctx, settings, action, scope) {
  switch (action) {
    case 'status':
      return statusOf(settings, scope)
    case 'check':
      return checkOf(ctx, settings, scope)
    case 'pull':
      return pullOf(ctx, settings, scope)
    case 'push':
      return pushOf(ctx, settings, scope)
    default:
      return { ok: false, error: 'unknown-action' }
  }
}

/**
 * Fast, network-free snapshot used to decide whether the button is usable.
 * Counts come from the local remote-tracking refs and may be stale, and the
 * working-tree scan is skipped because the first panel renders its own result.
 */
async function statusOf(settings, scope) {
  const base = { ok: true, cwd: scope.cwd }
  const repo = await inspectRepository(scope.cwd, settings, { includeDirty: false })
  if (!repo.isRepo) return { ...base, isRepo: false, detached: false }
  return {
    ...base,
    isRepo: true,
    branch: repo.branch,
    upstream: repo.upstream,
    detached: repo.detached,
    ahead: repo.ahead,
    behind: repo.behind,
    dirty: repo.dirty,
  }
}

/** Full preflight: fetch, compare, and act per the decided workflow. */
async function checkOf(ctx, settings, scope) {
  const base = { ok: true, cwd: scope.cwd }
  let repo = await inspectRepository(scope.cwd, settings)
  if (!repo.isRepo) return { ...base, isRepo: false, state: 'not-repo' }
  if (repo.detached || repo.upstream === undefined) {
    return {
      ...base,
      isRepo: true,
      state: 'no-upstream',
      branch: repo.branch,
      detached: repo.detached,
      dirty: repo.dirty,
    }
  }

  const remote = repo.upstream.slice(0, repo.upstream.indexOf('/'))
  const fetched = await runGit(scope.cwd, ['fetch', '--prune', remote], settings)
  if (fetched.code !== 0) {
    return {
      ...repoResult(base, repo),
      state: 'error',
      phase: 'fetch',
      detail: detailOf(fetched),
    }
  }

  repo = await inspectRepository(scope.cwd, settings)
  if (repo.upstream === undefined) {
    return { ...repoResult(base, repo), state: 'no-upstream' }
  }
  if (repo.ahead > 0 && repo.behind > 0) {
    const [localCommits, remoteCommits] = await Promise.all([
      listCommits(scope.cwd, `@{u}..HEAD`, settings),
      listCommits(scope.cwd, `HEAD..@{u}`, settings),
    ])
    return {
      ...repoResult(base, repo),
      state: 'diverged',
      commits: localCommits,
      remoteCommits,
    }
  }
  if (repo.ahead === 0 && repo.behind === 0) {
    return { ...repoResult(base, repo), state: 'up-to-date' }
  }
  if (repo.behind > 0) {
    if (!settings.autoPull) {
      return {
        ...repoResult(base, repo),
        state: 'remote-ahead',
        commits: await listCommits(scope.cwd, `HEAD..@{u}`, settings),
      }
    }
    return pullOf(ctx, settings, scope, repo)
  }
  return {
    ...repoResult(base, repo),
    state: 'push-required',
    commits: await listCommits(scope.cwd, `@{u}..HEAD`, settings),
  }
}

/** Pull fast-forward only, summarize the commits, then let the Agent review them. */
async function pullOf(ctx, settings, scope, knownRepo) {
  const base = { ok: true, cwd: scope.cwd }
  let repo = knownRepo ?? (await inspectRepository(scope.cwd, settings))
  if (!repo.isRepo) return { ...base, isRepo: false, state: 'not-repo' }
  if (repo.detached || repo.upstream === undefined) {
    return {
      ...base,
      isRepo: true,
      state: 'no-upstream',
      branch: repo.branch,
      detached: repo.detached,
      dirty: repo.dirty,
    }
  }
  if (repo.ahead > 0 && repo.behind > 0) {
    return {
      ...repoResult(base, repo),
      state: 'diverged',
      commits: await listCommits(scope.cwd, `@{u}..HEAD`, settings),
      remoteCommits: await listCommits(scope.cwd, `HEAD..@{u}`, settings),
    }
  }
  if (repo.behind === 0) {
    return { ...repoResult(base, repo), state: 'up-to-date' }
  }

  const before = await revParse(scope.cwd, 'HEAD', settings)
  const pulled = await runGit(scope.cwd, ['pull', '--ff-only'], settings)
  if (pulled.code !== 0) {
    return { ...repoResult(base, repo), state: 'error', phase: 'pull', detail: detailOf(pulled) }
  }
  const after = await revParse(scope.cwd, 'HEAD', settings)
  const range = before !== undefined && after !== undefined && before !== after
    ? `${before}..${after}`
    : 'HEAD@{1}..HEAD'
  const commits = await listCommits(scope.cwd, range, settings)
  const countResult = await runGit(scope.cwd, ['rev-list', '--count', range], settings)
  const pulledCount = countResult.code === 0
    ? Number.parseInt(countResult.stdout.trim(), 10) || commits.length
    : commits.length
  const stat = await runGit(scope.cwd, ['diff', '--stat', range], settings)
  const files = await runGit(scope.cwd, ['diff', '--name-only', range], settings)
  const updated = await inspectRepository(scope.cwd, settings)

  const summary = {
    branch: updated.branch,
    upstream: updated.upstream,
    count: pulledCount,
    commits,
    stat: truncate(stat.stdout.trim(), MAX_STAT_CHARS),
    files: files.stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 200),
  }
  const ai = settings.aiFamiliarize
    ? queueAgentReview(ctx, settings, scope, summary)
    : { enabled: false, queued: false, reason: 'disabled' }

  return {
    ...repoResult(base, updated),
    state: 'pulled',
    pulledCount,
    commits,
    files: summary.files,
    stat: summary.stat,
    ai,
  }
}

/** Push the current branch after the user confirms the commit list. */
async function pushOf(ctx, settings, scope) {
  const base = { ok: true, cwd: scope.cwd }
  const repo = await inspectRepository(scope.cwd, settings)
  if (!repo.isRepo) return { ...base, isRepo: false, state: 'not-repo' }
  if (repo.detached || repo.upstream === undefined) {
    return {
      ...base,
      isRepo: true,
      state: 'no-upstream',
      branch: repo.branch,
      detached: repo.detached,
      dirty: repo.dirty,
    }
  }
  if (repo.behind > 0) {
    return {
      ...repoResult(base, repo),
      state: 'diverged',
      commits: await listCommits(scope.cwd, `@{u}..HEAD`, settings),
      remoteCommits: await listCommits(scope.cwd, `HEAD..@{u}`, settings),
    }
  }
  if (repo.ahead === 0) {
    return { ...repoResult(base, repo), state: 'up-to-date' }
  }

  const commits = await listCommits(scope.cwd, `@{u}..HEAD`, settings)
  // Push exactly the confirmed branch to its upstream, even when the user's
  // push.default is `matching`, so the pushed range matches what was listed.
  const separator = repo.upstream.indexOf('/')
  const remote = separator > 0 ? repo.upstream.slice(0, separator) : ''
  const remoteBranch = separator > 0 ? repo.upstream.slice(separator + 1) : ''
  const pushArgs = remote !== '' && remoteBranch !== '' ? ['push', remote, `HEAD:${remoteBranch}`] : ['push']
  const pushed = await runGit(scope.cwd, pushArgs, settings)
  if (pushed.code !== 0) {
    return { ...repoResult(base, repo), state: 'error', phase: 'push', detail: detailOf(pushed) }
  }
  const updated = await inspectRepository(scope.cwd, settings)
  return {
    ...repoResult(base, updated),
    state: 'pushed',
    pushedCount: repo.ahead,
    commits,
    pushOutput: truncate(`${pushed.stdout}\n${pushed.stderr}`.trim(), MAX_DETAIL_CHARS),
  }
}

/**
 * Inspect the repository: identity, branch, upstream, divergence, and dirty
 * count. Every field is derived from disposable git invocations; a failed
 * command simply means the field is unavailable.
 * @param options.includeDirty - set false to skip the working-tree scan.
 */
async function inspectRepository(cwd, settings, options = {}) {
  const empty = { isRepo: false, detached: false }
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], settings)
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return empty

  const branchResult = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], settings)
  const detached = branchResult.code !== 0
  const branch = detached ? undefined : branchResult.stdout.trim()

  const upstreamResult = detached
    ? { code: 1, stdout: '' }
    : await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], settings)
  const upstream = !detached && upstreamResult.code === 0 && upstreamResult.stdout.trim() !== ''
    ? upstreamResult.stdout.trim()
    : undefined

  let ahead
  let behind
  if (upstream !== undefined) {
    const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], settings)
    if (counts.code === 0) {
      const [left, right] = counts.stdout.trim().split(/\s+/)
      const aheadValue = Number.parseInt(left ?? '', 10)
      const behindValue = Number.parseInt(right ?? '', 10)
      if (Number.isFinite(aheadValue) && Number.isFinite(behindValue)) {
        ahead = aheadValue
        behind = behindValue
      }
    }
  }

  let dirty
  if (options.includeDirty !== false) {
    const status = await runGit(cwd, ['status', '--porcelain'], settings)
    dirty = status.code === 0
      ? status.stdout.split('\n').filter((line) => line.length > 0).length
      : undefined
  }

  return { isRepo: true, branch, upstream, detached, ahead, behind, dirty }
}

/** Resolve the Session's effective directory without trusting Client input. */
function resolveSessionDirectory(ctx, sessionId) {
  if (sessionId === '') return undefined
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) return undefined
  try {
    const directory = ctx.workingDirectory.get(session)
    if (typeof directory === 'string' && directory !== '') return directory
  } catch {
    // Fall through to the durable header.
  }
  const headerDirectory = session.header?.cwd
  return typeof headerDirectory === 'string' && headerDirectory !== '' ? headerDirectory : undefined
}

/** Compact list of commits in one range, newest first. */
async function listCommits(cwd, range, settings) {
  const result = await runGit(
    cwd,
    ['log', '--no-color', '--date=short', '--pretty=format:%h%x1f%s%x1f%an%x1f%ad', '-n', String(settings.commitListLimit), range],
    settings,
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash = '', subject = '', author = '', date = ''] = line.split('\x1f')
      return { hash, subject, author, date }
    })
}

/** Resolve one revision to a full hash, or `undefined` when it does not exist. */
async function revParse(cwd, revision, settings) {
  const result = await runGit(cwd, ['rev-parse', '--verify', revision], settings)
  return result.code === 0 ? result.stdout.trim() : undefined
}

/**
 * Ask the current Agent to review the pulled commits. The follow-up is a
 * normal user-visible message, so the Session log stays the single source of
 * truth and the review is reproducible from the log alone.
 */
function queueAgentReview(ctx, settings, scope, summary) {
  const agent = ctx.agents.get(scope.sessionId)
  if (agent === undefined || typeof agent.followup !== 'function') {
    return { enabled: true, queued: false, reason: 'session-not-live' }
  }
  const text = buildReviewPrompt(settings, scope.locale, summary)
  try {
    agent.followup(userMessage(text))
    return { enabled: true, queued: true }
  } catch (error) {
    return { enabled: true, queued: false, reason: describe(error) }
  }
}

/** Follow-up prompt handed to the Agent after a pull. */
function buildReviewPrompt(settings, locale, summary) {
  const shown = summary.commits.map((commit) => `- ${commit.hash} ${commit.subject}`).join('\n')
  const truncated = summary.count > summary.commits.length
  const list = truncated
    ? `${shown}\n${locale === 'zh' ? `（仅列出最近 ${summary.commits.length} 个，共 ${summary.count} 个）` : `(only the latest ${summary.commits.length} of ${summary.count} commits are listed)`}`
    : shown
  const files = summary.files.length > 0 ? summary.files.map((file) => `- ${file}`).join('\n') : '(none listed)'
  const stat = summary.stat === '' ? '(empty)' : summary.stat
  const branch = summary.branch ?? 'unknown'
  const upstream = summary.upstream ?? 'upstream'
  if (typeof settings.aiPromptTemplate === 'string' && settings.aiPromptTemplate.trim() !== '') {
    return settings.aiPromptTemplate
      .replaceAll('{branch}', branch)
      .replaceAll('{upstream}', upstream)
      .replaceAll('{count}', String(summary.count))
      .replaceAll('{commits}', list)
      .replaceAll('{stat}', stat)
      .replaceAll('{summary}', `${list}\n\n${stat}`)
  }
  if (locale === 'zh') {
    return [
      'Vibecoding 前置检查刚刚把远程仓库的最新代码拉取到了本地，请先熟悉这些变更。',
      '',
      `分支：${branch}（上游 ${upstream}），本次拉取 ${summary.count} 个提交。`,
      '',
      '提交列表：',
      list || '(无)',
      '',
      '改动文件：',
      files,
      '',
      'git diff --stat：',
      '```',
      stat,
      '```',
      '',
      '请阅读这些变更（需要时可自行查看具体 diff），然后用简洁的中文总结：本次拉取改了什么、可能影响当前工作的点、以及继续 vibecoding 时需要注意什么。',
    ].join('\n')
  }
  return [
    'The vibecoding preflight just pulled the latest commits from the remote into this project. Please get familiar with the changes first.',
    '',
    `Branch: ${branch} (upstream ${upstream}); ${summary.count} commit(s) pulled.`,
    '',
    'Commits:',
    list || '(none)',
    '',
    'Changed files:',
    files,
    '',
    'git diff --stat:',
    '```',
    stat,
    '```',
    '',
    'Review these changes (inspect the actual diff when needed), then summarize briefly: what changed, what may affect the current work, and what to watch out for before continuing to vibecode.',
  ].join('\n')
}

/** One identified, frozen user message accepted by the Agent inbox. */
function userMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** Freeze a JSON-shaped value deeply, matching the message factory's contract. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * Run one git command in `cwd`.
 *
 * Output is captured through temporary files rather than pipes so the same
 * code works under a sandbox that refuses to open named pipes; the child never
 * sees a shell, so every argument reaches git verbatim.
 * @returns stdout, stderr, exit code, and whether the timeout fired.
 */
function runGit(cwd, args, settings) {
  return new Promise((resolve) => {
    let directory
    let stdoutFd
    let stderrFd
    try {
      directory = mkdtempSync(join(tmpdir(), 'dsh-vibecoding-preflight-'))
      const stdoutPath = join(directory, 'stdout')
      const stderrPath = join(directory, 'stderr')
      stdoutFd = openSync(stdoutPath, 'w')
      stderrFd = openSync(stderrPath, 'w')
    } catch (error) {
      cleanup()
      resolve({ code: -1, stdout: '', stderr: describe(error), timedOut: false })
      return
    }

    let child
    try {
      child = spawn('git', args, {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: process.env,
      })
    } catch (error) {
      cleanup()
      resolve({ code: -1, stdout: '', stderr: describe(error), timedOut: false })
      return
    }
    // The child holds its own duplicated descriptors.
    closeQuietly()

    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // The process already exited.
      }
    }, settings.timeoutMs)

    const settle = (code, extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = readQuietly(stdoutFdPath(directory))
      const stderr = readQuietly(stderrFdPath(directory)) || extra
      cleanup()
      resolve({ code, stdout, stderr, timedOut })
    }

    child.on('error', (error) => settle(-1, describe(error)))
    child.on('close', (code) => settle(typeof code === 'number' ? code : -1, timedOut ? 'git command timed out' : ''))

    /** Close the parent's copies of the redirected files. */
    function closeQuietly() {
      for (const fd of [stdoutFd, stderrFd]) {
        try {
          closeSync(fd)
        } catch {
          // Already closed.
        }
      }
    }

    /** Remove the temporary capture directory. */
    function cleanup() {
      try {
        if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
      } catch {
        // Best effort; a leftover temp file is harmless.
      }
    }
  })
}

/** Absolute path of a capture file, or `undefined` before the temp dir exists. */
function stdoutFdPath(directory) {
  return directory === undefined ? undefined : join(directory, 'stdout')
}

/** Absolute path of the stderr capture file. */
function stderrFdPath(directory) {
  return directory === undefined ? undefined : join(directory, 'stderr')
}

/** Read one capture file, tolerating an absent or unreadable path. */
function readQuietly(path) {
  if (path === undefined) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** Throw-away base fields for a repository-backed response. */
function repoResult(base, repo) {
  return {
    ...base,
    isRepo: true,
    branch: repo.branch,
    upstream: repo.upstream,
    detached: repo.detached,
    ahead: repo.ahead,
    behind: repo.behind,
    dirty: repo.dirty,
  }
}

/** Merge the row config over the defaults, tolerating odd values. */
function resolveConfig(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const settings = { ...DEFAULTS, ...raw }
  if (!Number.isFinite(settings.timeoutMs) || settings.timeoutMs < 1000) settings.timeoutMs = DEFAULTS.timeoutMs
  if (!Number.isInteger(settings.commitListLimit) || settings.commitListLimit < 1) settings.commitListLimit = DEFAULTS.commitListLimit
  if (typeof settings.autoPull !== 'boolean') settings.autoPull = DEFAULTS.autoPull
  if (typeof settings.aiFamiliarize !== 'boolean') settings.aiFamiliarize = DEFAULTS.aiFamiliarize
  if (typeof settings.aiPromptTemplate !== 'string') settings.aiPromptTemplate = DEFAULTS.aiPromptTemplate
  return settings
}

/** Whether a request comes from the page this Host serves. */
function isTrustedRequest(ctx, request) {
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  let expected
  try {
    expected = ctx.webServer.getOrigin()
  } catch {
    return true
  }
  return normalizeOrigin(origin) === normalizeOrigin(expected)
}

/** Compare origins without a trailing slash. */
function normalizeOrigin(value) {
  return String(value).replace(/\/+$/, '')
}

/** Read and parse one bounded JSON body. */
function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size === 0) return finish({})
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(undefined)
      }
    })
    request.on('error', () => finish(undefined))
  })
}

/** Write one JSON response. */
function writeJson(response, status, payload) {
  if (response.writableEnded) return
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Bounded, single-line summary of a failed command for display. */
function detailOf(result) {
  const text = `${result.stdout}\n${result.stderr}`.replace(/\r/g, '').trim()
  const first = text === '' ? `git exited with code ${result.code}` : text
  return truncate(first, MAX_DETAIL_CHARS)
}

/** Bound a string for the wire. */
function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

/** Message text for an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
