# dsh-vibecoding-preflight

Git preflight check for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) vibecoding sessions.

[中文说明](README.zh.md)

Before asking the AI to change code, make sure it starts from the latest code and that your own commits are not stranded locally. This plugin adds one button to the conversation header that does exactly that.

## What it does

- **Non-repository projects are greyed out.** The button checks the session directory with `git rev-parse --is-inside-work-tree` when the session opens; outside a Git work tree it is disabled with an explanatory tooltip.
- **One click runs the whole preflight** for the current branch and its upstream:
  - **identical** — the local branch matches the remote: only a notice, nothing is executed;
  - **remote ahead** — `git pull --ff-only` runs automatically, then the changed commits and `git diff --stat` are handed to the current Agent as a follow-up prompt so it reviews what changed;
  - **local ahead** — the ahead commits are listed (hash, subject, author, date) and nothing happens until you confirm **Push to remote**;
  - **diverged / no upstream / fetch error** — reported with the reason, and no destructive git command is ever executed.
- **Uncommitted changes** are shown as a hint; they never block a check, and `--ff-only` failures are reported verbatim.

## Usage

1. Open a session in a Git project.
2. Click **Git preflight** in the conversation header (next to the session title).
3. Read the result card and act on it:
   - remote ahead: wait for the pull, then the AI replies with a summary of the new commits;
   - local ahead: review the listed commits and press **Push to remote** or **Cancel**;
   - up to date: nothing else to do.

## Configuration

The row config in `cordis.patch.yml` is passed straight to the Host half and can be overridden in your profile patch:

| Key | Default | Meaning |
| --- | --- | --- |
| `autoPull` | `true` | Pull automatically when the remote is strictly ahead. When `false`, the panel offers a **Pull** button instead. |
| `aiFamiliarize` | `true` | Queue an Agent follow-up asking it to review the pulled commits. |
| `commitListLimit` | `20` | Maximum commits listed per direction. |
| `timeoutMs` | `120000` | Timeout for a single git invocation. |
| `aiPromptTemplate` | `''` | Optional follow-up prompt template. Supports `{branch}`, `{upstream}`, `{count}`, `{commits}`, `{stat}`, `{summary}`. |

## How it works

- **Host half** (`index.js`) registers four same-origin JSON routes under `/vibecoding-preflight/api/` (`status`, `check`, `pull`, `push`) on `ctx.webServer`. It resolves the session's working directory from `ctx.sessions` / `ctx.workingDirectory`, runs `git` with an argument array (no shell string), captures output through temporary files, and never uses destructive git commands (the only writes are `git fetch --prune`, `git pull --ff-only`, and the user-confirmed `git push <remote> HEAD:<branch>`).
- **Client half** (`client.js`) registers one pill button into `conversation.session.header.actions`, portals the result card to `document.body` (the header clips overflow), and routes all copy through the Client locale service (`en` / `zh`).
- DSH builds its typed `ctx.remote` namespaces at build time, so a runtime bundle cannot add one of its own; same-origin routes are the supported path for a plugin's own Client→Host calls.

## Limitations

- Only the current branch and its configured upstream are handled; multiple remotes, detached HEAD, and worktrees are reported rather than acted on.
- Network access relies on the system `git` configuration (credentials, proxies, SSH keys). A fetch/push failure is shown verbatim; the plugin never stores or asks for credentials.
- The "AI review" is a normal user-visible follow-up turn: it appears in the session log and may take a moment while the Agent reads the diff.
- Requires a DSH build that provides `webServer`, `sessions`, `agents`, and `workingDirectory` services (Web GUI / desktop builds).

## Install

Install the package directory as a bundle in your DSH profile (**Settings → Plugins → Add plugin** with a local directory, or `dsh` plugin tooling), then enable the row `vibecoding-preflight` if it is not enabled automatically.

## Development

The bundle is plain JavaScript with no build step:

```text
index.js            Host half (routes + git execution + Agent follow-up)
client.js           Client half (browser module, slot registration, panel UI)
cordis.patch.yml    Loader row
locale/en.json      Plugin Manager display metadata (English)
locale/zh.json      Plugin Manager display metadata (Chinese)
docs/               Requirements, detail pages, preview image
```

## License

[MIT](LICENSE)
