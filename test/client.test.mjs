/**
 * Client-half structural test.
 *
 * `client.js` is a browser artifact: it assigns a lazy factory to
 * `window.__ModuleLoader__`. This test installs that facade plus a minimal
 * React/DOM stand-in, loads the real artifact, and drives the factory with a
 * fake Client context. It verifies the module id, the injected services, the
 * slot registration handed to the conversation header, the locale
 * dictionaries, and the injected per-Session face — everything the browser
 * would execute before rendering, without a browser.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

/** Collect `__ModuleLoader__.load()` calls made by browser artifacts. */
const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded.push(module)
    },
  },
}

/** Minimal document surface used by `apply()` when it installs the stylesheet. */
globalThis.document = {
  createElement() {
    return { dataset: {}, textContent: '', remove() {} }
  },
  head: { appendChild() {} },
}

// A fresh module instance: the artifact runs once when it is imported.
await import('../client.js')

/** Everything the browser module requested through its `require` facade. */
const modules = new Map([
  ['react', {}],
  ['react-dom', { createPortal: () => null }],
])

test('registers exactly one browser module under the package name', () => {
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-vibecoding-preflight')
  assert.equal(typeof loaded[0].factory, 'function')
})

test('registers the header action and locale dictionaries', () => {
  const plugin = loaded[0].factory((id) => {
    assert.ok(modules.has(id), `unexpected require(${id})`)
    return modules.get(id)
  })

  assert.deepEqual(plugin.inject, ['slots', 'locale'])

  const injections = []
  const registrations = []
  const dictionaries = []
  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      register(...args) {
        assert.equal(args[0], 'vibecoding-preflight')
        dictionaries.push({ locale: args[1], dict: args[2] })
        return () => {}
      },
      bind() {
        return (key) => key
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: 'en', locales: [], revision: 1 }
      },
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }

  plugin.apply(ctx)

  assert.deepEqual(injections, ['conversation.session.header.actions'])
  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'conversation.session.header.actions')
  assert.equal(options.id, 'vibecoding-preflight')
  assert.equal(typeof options.order, 'number')
  assert.equal(typeof component, 'function')
  assert.equal(typeof options.inject, 'function')

  assert.deepEqual(dictionaries.map((entry) => entry.locale).sort(), ['en', 'zh'])
  for (const { locale, dict } of dictionaries) {
    for (const key of ['button.label', 'panel.title', 'panel.upToDate', 'panel.pulled', 'panel.pushRequired', 'panel.diverged']) {
      assert.equal(typeof dict[key], 'string', `${locale} dictionary is missing ${key}`)
    }
  }
})

test('injects the session id and a translation face into the component', () => {
  const plugin = loaded[0].factory((id) => modules.get(id))
  const registrations = []
  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: 'zh', locales: [], revision: 2 }
      },
    },
    slots: {
      inject(key, callback) {
        callback()
      },
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const injected = registrations[0].inject('session-123')
  assert.equal(injected.sessionId, 'session-123')
  assert.equal(typeof injected.t, 'function')
  assert.equal(typeof injected.subscribe, 'function')
  assert.equal(typeof injected.getSnapshot, 'function')
  assert.equal(injected.getSnapshot().active, 'zh')
})

test('renders the icon and label inside the button element', () => {
  const Fragment = Symbol('Fragment')
  const ReactStub = {
    Fragment,
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } }
    },
    useState(initial) {
      return [initial, () => {}]
    },
    useRef(initial) {
      return { current: initial }
    },
    useCallback(callback) {
      return callback
    },
    useEffect() {},
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
  const plugin = loaded[0].factory((id) => (id === 'react' ? ReactStub : modules.get(id)))

  const registrations = []
  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: 'en', locales: [], revision: 1 }
      },
    },
    slots: {
      inject(key, callback) {
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  const component = registrations[0].component
  const tree = component({
    sessionId: 'session-123',
    t: (key) => key,
    subscribe: () => () => {},
    getSnapshot: () => ({ active: 'en', locales: [], revision: 1 }),
  })

  /** Flatten the fake element tree into a list. */
  const flatten = (node, out = []) => {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out)
      return out
    }
    out.push(node)
    for (const child of node.props?.children ?? []) flatten(child, out)
    return out
  }

  const nodes = flatten(tree)
  const button = nodes.find((node) => node.type === 'button')
  assert.ok(button !== undefined, 'the header action must render a button')
  const buttonChildren = button.props.children.filter((child) => typeof child !== 'string' || child.length > 0)
  assert.equal(buttonChildren.length, 2, 'the button must own exactly the glyph and the label')
  assert.equal(buttonChildren[0].type.name, 'Glyph')
  assert.equal(buttonChildren[1].type, 'span')
  assert.equal(typeof buttonChildren[1].props.children[0], 'string')

  // While the initial status is still loading the control is muted but still
  // clickable, so a directory that becomes a repository recovers on click.
  assert.equal(button.props['data-muted'], 'true')
  assert.equal(button.props['aria-haspopup'], 'dialog')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(button.props.disabled, false, 'muted is not the native disabled attribute')
  assert.equal(typeof button.props.onClick, 'function', 'the muted button must still re-check on click')
})
