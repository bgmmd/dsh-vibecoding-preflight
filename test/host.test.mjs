/**
 * Host-half integration test.
 *
 * The plugin's Host routes expect a Cordis context, so this test mounts the
 * real `apply()` on a minimal fake context, invokes the registered handlers
 * with Node request/response stand-ins, and runs the real `git` binary against
 * a throwaway repository with a local bare remote. No network access and no
 * browser are involved.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { apply, inject } from '../index.js'

const SESSION_ID = 'session-test'
const ORIGIN = 'http://127.0.0.1:1234'

/** Repositories created for one test run. */
let root
/** Working checkout the fake Session points at. */
let work
/** Second checkout that plays the remote writer. */
let other
/** Bare repository acting as the remote. */
let remote

/** Run git and fail loudly on a non-zero exit. */
function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=Preflight Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** Create one commit in `dir` and return its subject. */
function commit(dir, subject) {
  writeFileSync(join(dir, `${subject.replace(/\s+/g, '-')}.txt`), `${subject}\n`)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', subject])
  return subject
}

/** Land one commit on the remote through the second checkout. */
function remoteCommit(subject) {
  git(other, ['fetch', 'origin'])
  git(other, ['reset', '--hard', 'origin/main'])
  commit(other, subject)
  git(other, ['push', 'origin', 'main'])
  return subject
}

/** Mount the plugin on a fake context covering the services it injects. */
function mount(cwd, config = {}) {
  const routes = new Map()
  const followups = []
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      getOrigin: () => ORIGIN,
    },
    sessions: {
      get: (id) => (id === SESSION_ID ? { header: { cwd } } : undefined),
    },
    workingDirectory: { get: () => cwd },
    agents: {
      get: (id) => (id === SESSION_ID ? { followup: (message) => followups.push(message) } : undefined),
    },
    effect(callback) {
      return callback()
    },
  }
  apply(ctx, config)
  return { routes, followups }
}

/** Stand-in for one Node IncomingMessage carrying a JSON body. */
function request(body, options = {}) {
  const emitter = new EventEmitter()
  emitter.method = options.method ?? 'POST'
  emitter.headers = {
    'content-type': 'application/json',
    ...options.headers,
  }
  emitter.destroy = () => {}
  queueMicrotask(() => {
    if (body !== undefined) emitter.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
    emitter.emit('end')
  })
  return emitter
}

/** Stand-in for one Node ServerResponse capturing status and JSON body. */
function response() {
  return {
    status: undefined,
    payload: undefined,
    writableEnded: false,
    writeHead(status) {
      this.status = status
    },
    end(buffer) {
      this.writableEnded = true
      this.payload = JSON.parse(buffer.toString('utf8'))
    },
  }
}

/** Invoke one registered route and return the parsed response. */
async function call(routes, action, body = {}, options = {}) {
  const route = routes.get(`/vibecoding-preflight/api/${action}`)
  assert.ok(route !== undefined, `missing route ${action}`)
  const res = response()
  await route.handler(request(body, options), res)
  return { status: res.status, body: res.payload }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'vibecoding-preflight-test-'))
  remote = join(root, 'remote.git')
  work = join(root, 'work')
  other = join(root, 'other')

  mkdirSync(remote)
  git(remote, ['init', '--bare', '-b', 'main'])
  mkdirSync(work)
  git(work, ['init', '-b', 'main'])
  commit(work, 'initial commit')
  git(work, ['remote', 'add', 'origin', remote])
  git(work, ['push', '-u', 'origin', 'main'])
  git(root, ['clone', remote, other])
})

after(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

test('declares the Host services it depends on', () => {
  for (const service of ['webServer', 'sessions', 'agents', 'workingDirectory']) {
    assert.ok(inject.includes(service), `missing injected service ${service}`)
  }
})

test('reports a non-repository directory', async () => {
  const plain = join(root, 'plain')
  mkdirSync(plain)
  const { routes } = mount(plain)
  const status = await call(routes, 'status', { sessionId: SESSION_ID })
  assert.equal(status.body.isRepo, false)
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'not-repo')
})

test('reports an unknown session without leaking a directory', async () => {
  const { routes } = mount(work)
  const result = await call(routes, 'status', { sessionId: 'missing-session' })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error, 'session-not-found')
})

test('detects an in-sync branch', async () => {
  const { routes } = mount(work)
  const status = await call(routes, 'status', { sessionId: SESSION_ID })
  assert.equal(status.body.isRepo, true)
  assert.equal(status.body.branch, 'main')
  assert.equal(status.body.upstream, 'origin/main')
  assert.equal(status.body.ahead, 0)
  assert.equal(status.body.behind, 0)

  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'up-to-date')
})

test('lists local commits and pushes them after confirmation', async () => {
  const subject = 'local work before vibecoding'
  commit(work, subject)
  const { routes } = mount(work)

  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'push-required')
  assert.equal(check.body.ahead, 1)
  assert.equal(check.body.commits.length, 1)
  assert.equal(check.body.commits[0].subject, subject)

  const push = await call(routes, 'push', { sessionId: SESSION_ID })
  assert.equal(push.body.state, 'pushed')
  assert.equal(push.body.ahead, 0)
  assert.equal(git(remote, ['log', '-1', '--format=%s', 'main']), subject)
})

test('pulls a remote-ahead branch and hands the commits to the Agent', async () => {
  const subject = remoteCommit('remote work from a teammate')

  const { routes, followups } = mount(work)
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'pulled')
  assert.equal(check.body.behind, 0)
  assert.ok(check.body.commits.some((entry) => entry.subject === subject))
  assert.equal(check.body.ai.enabled, true)
  assert.equal(check.body.ai.queued, true)

  assert.equal(followups.length, 1)
  const prompt = followups[0].content[0].text
  assert.match(prompt, new RegExp(subject))
  assert.match(prompt, /git diff --stat/)
  assert.equal(git(work, ['log', '-1', '--format=%s']), subject)
})

test('reports divergence without changing the branch', async () => {
  remoteCommit('remote side of the divergence')
  const before = git(work, ['rev-parse', 'HEAD'])
  commit(work, 'local side of the divergence')

  const { routes, followups } = mount(work)
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'diverged')
  assert.ok(check.body.ahead > 0)
  assert.ok(check.body.behind > 0)
  assert.equal(followups.length, 0)
  assert.equal(git(work, ['rev-parse', 'HEAD@{1}']), before)
  assert.equal(git(work, ['log', '-1', '--format=%s']), 'local side of the divergence')
})

test('reports a branch without an upstream and never pushes it', async () => {
  git(work, ['checkout', '-b', 'feature/no-upstream'])
  const { routes } = mount(work)
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'no-upstream')

  const push = await call(routes, 'push', { sessionId: SESSION_ID })
  assert.equal(push.body.state, 'no-upstream')
  const branches = git(remote, ['branch', '--format=%(refname:short)'])
  assert.doesNotMatch(branches, /no-upstream/)
})

test('honours autoPull=false by offering an explicit pull', async () => {
  git(work, ['checkout', 'main'])
  // The divergence test left a local commit on main; start from the remote tip.
  git(work, ['fetch', 'origin'])
  git(work, ['reset', '--hard', 'origin/main'])
  const subject = remoteCommit('one more remote commit')

  const { routes } = mount(work, { autoPull: false })
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'remote-ahead')

  const pull = await call(routes, 'pull', { sessionId: SESSION_ID })
  assert.equal(pull.body.state, 'pulled')
})

test('rejects cross-site, non-JSON, and non-POST requests', async () => {
  const { routes } = mount(work)

  const crossSite = await call(routes, 'status', { sessionId: SESSION_ID }, {
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(crossSite.status, 403)

  const crossSiteFetch = await call(routes, 'status', { sessionId: SESSION_ID }, {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSiteFetch.status, 403)

  const sameOrigin = await call(routes, 'status', { sessionId: SESSION_ID }, {
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(sameOrigin.status, 200)

  const notJson = await call(routes, 'status', { sessionId: SESSION_ID }, {
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(notJson.status, 415)

  const get = await call(routes, 'status', { sessionId: SESSION_ID }, { method: 'GET' })
  assert.equal(get.status, 405)
})

test('tolerates a malformed config object', async () => {
  const { routes } = mount(work, { timeoutMs: 'soon', commitListLimit: -3, autoPull: 'yes' })
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(typeof check.body.ok, 'boolean')
})

test('reports a detached HEAD as such without touching the repository', async () => {
  git(work, ['checkout', '--detach'])
  const head = git(work, ['rev-parse', 'HEAD'])

  const { routes } = mount(work)
  const check = await call(routes, 'check', { sessionId: SESSION_ID })
  assert.equal(check.body.state, 'no-upstream')
  assert.equal(check.body.detached, true)
  assert.equal(git(work, ['rev-parse', 'HEAD']), head)
  assert.equal(git(work, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD')
})

test('a colliding pull fails safe and leaves no conflicted tree', async () => {
  git(work, ['checkout', 'main'])
  git(work, ['fetch', 'origin'])
  git(work, ['reset', '--hard', 'origin/main'])
  const slug = 'incoming-change-that-collides.txt'
  remoteCommit('incoming change that collides')
  // Local work in progress on the same path the incoming commit adds.
  writeFileSync(join(work, slug), 'local work in progress\n')
  const headBefore = git(work, ['rev-parse', 'HEAD'])

  const { routes, followups } = mount(work)
  const result = await call(routes, 'check', { sessionId: SESSION_ID })

  // The request still succeeds: the pull refusal is a reported state, not a crash.
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.state, 'error')
  assert.equal(result.body.phase, 'pull')
  assert.match(result.body.detail, /overwritten|local changes/i)

  // Nothing moved, nothing was clobbered, and no merge/conflict state exists.
  assert.equal(git(work, ['rev-parse', 'HEAD']), headBefore)
  assert.equal(readFileSync(join(work, slug), 'utf8'), 'local work in progress\n')
  assert.equal(existsSync(join(work, '.git', 'MERGE_HEAD')), false)
  assert.equal(existsSync(join(work, '.git', 'rebase-merge')), false)
  const porcelain = git(work, ['status', '--porcelain'])
  assert.match(porcelain, /^\?\? incoming-change-that-collides\.txt$/m)
  assert.doesNotMatch(porcelain, /^(UU|AA|DD|AU|UA|DU|UD) /m)
  assert.equal(followups.length, 0)
})
