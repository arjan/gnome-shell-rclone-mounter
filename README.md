# Rclone Mounter

A GNOME Shell extension that mounts and unmounts your [rclone][rclone] remotes
from a panel menu. Every remote in your rclone configuration appears as a
switch: flip it on to mount, off to unmount.

> Generated with AI for personal use. Do **not** upload this to
> [extensions.gnome.org][ego] unless you understand JavaScript and are willing to
> maintain it — see [Publishing](#publishing) below.

## Requirements

- GNOME Shell 49
- `rclone` in `PATH` (developed against 1.75)
- `fusermount3` (or `fusermount`), part of the `fuse3` package
- At least one remote configured with `rclone config`

## Install

```bash
make install     # symlinks this checkout into ~/.local/share/gnome-shell/extensions
make schemas     # compile the GSettings schema
```

GNOME Shell only scans for extensions at startup. On Wayland it cannot be
restarted in place, so **log out and back in**, then:

```bash
make enable
```

## Usage

Click the panel icon to see your remotes. The icon picks up the accent colour
while anything is mounted.

Mount points live in the extension's own settings, not in `rclone.conf` — see
[Why mount points are configured here](#why-mount-points-are-configured-here).
Open `make prefs` to set them. Each remote defaults to `~/mnt/<remote-name>`,
created automatically on first mount. Leading `~` is expanded, and clearing a
field restores the default.

The same window has a field for extra `rclone mount` flags applied to every
mount, defaulting to `--vfs-cache-mode=writes`. Anything `rclone mount` accepts
works here, for example `--read-only`, `--umask 002` or `--bwlimit 1M`.

## Why mount points are configured here

`rclone.conf` describes only *what* a remote is — its backend type and
credentials:

```ini
[gdrive-work]
type = drive
scope = drive
team_drive = 0ABCDEF
```

There is no key for a target directory, because the mount point is an argument
to `rclone mount` rather than a property of the remote. So the extension reads
`rclone.conf` to discover which remotes exist, and keeps the *where* in its own
GSettings (`mountpoints`, a remote-name to directory map).

## How it works

- **Discovery** parses `rclone.conf` as a plain INI file, honouring
  `RCLONE_CONFIG`, then `~/.config/rclone/rclone.conf`, then `~/.rclone.conf`.
  The menu rebuilds itself when the file changes, so newly added remotes appear
  without a reload.
- **State** is always read from `/proc/self/mounts`, looking for the
  `fuse.rclone` filesystem type, and refreshed from `Gio.UnixMountMonitor`.
  Nothing is cached, so mounts made outside the extension — by hand, fstab or a
  systemd unit — show as mounted too.
- **Mounting** runs `rclone mount --daemon`. Because rclone daemonises, the
  mount survives a GNOME Shell restart instead of dying with its parent, and
  rclone only exits successfully once the mount is actually ready, so failures
  are reported accurately as a notification.
- **Unmounting** calls `fusermount -u`, falling back to a lazy `-u -z` unmount.
  A plain unmount frequently fails with `EBUSY` because something on the desktop
  grabs a fresh mount almost immediately.

## Development

```bash
make check    # compile schemas, lint, run tests
make test     # headless test suite, no GNOME Shell needed
make lint     # eslint (npm install first)
make logs     # follow gnome-shell output
make nested   # nested shell to test changes without logging out
make pack     # distributable zip
```

`make nested` is the fast iteration loop on Wayland: it starts a second GNOME
Shell in a window that loads your working copy, so you do not have to end your
session to see changes. Note that a nested shell shares your dconf, so settings
changes there are real.

The test suite (`tests/smoke.js`) runs under plain `gjs` against a fixture
config and an in-memory GSettings backend, so it never reads your real
`rclone.conf` or writes to dconf.

### Layout

| Path | Process | Notes |
| --- | --- | --- |
| `extension.js` | shell | Entry point; `enable()`/`disable()` only |
| `shell/indicator.js` | shell | Panel button, menu, mount state |
| `prefs.js` | preferences | Adwaita preferences window |
| `lib/rclone.js` | both | Config parsing, mount state, mount/unmount |
| `schemas/` | — | GSettings schema |
| `tests/` | — | Headless gjs checks |

The two processes are isolated, so `lib/rclone.js` is shared code and must never
import `St`, `Clutter`, `Gtk`, `Gdk` or `Adw`.

### Agentic development

`best-practices.md` is the upstream GNOME/EGO guidance for AI-generated
extensions and is the authority for this codebase. The conventions and the
verification workflow are encoded as always-on Cursor rules in `.cursor/rules/`,
so an agent picks them up automatically. The short version: target GNOME 49
only, no defensive compatibility checks, clean up in `destroy()`, and verify
with `make check` rather than assuming.

When testing mounts, never disturb a mount you did not create — use a scratch
mount point with `--read-only` and lazy-unmount it afterwards.

## Caveats

- Encrypted rclone configurations are not supported; there is nowhere to enter
  the config password.
- A mount that dies on its own is reflected in the menu, but you are not
  notified about it.
- Mount flags are global rather than per remote.
- Remotes are always mounted at their root, not at a subpath.

## Extras worth adding

Ideas, roughly in order of usefulness:

- **Open in Files** — a per-remote menu action that opens the mount point.
- **Mount at login** — a per-remote toggle that mounts on `enable()`.
- **systemd user units** instead of `--daemon`, giving restart-on-failure and
  proper logging per mount.
- **Per-remote flags**, so one remote can be read-only and another cached.
- **Free space and usage** per remote via `rclone about`, shown in the menu.
- **Health notifications** when a mount disappears unexpectedly.
- **Live transfer stats** through rclone's `rc` API, for a spinner or throughput
  readout while files are syncing.
- **Keyboard shortcuts** for toggling a specific remote.
- **Subpath mounts**, mounting `remote:some/folder` rather than the root.
- **Encrypted config support** by prompting for the password and passing it via
  `RCLONE_CONFIG_PASS`.
- **Translations** — the strings are already wrapped in `gettext`, so only the
  `po/` machinery is missing.

## Publishing

The generated files carry an "AI for personal use" notice, which EGO reviewers
expect on AI-generated code. If you review the code, understand it and intend to
maintain it, remove those notice comments before submitting — leaving them in
suggests the author never read the code and will be flagged during review.

## License

GPL-2.0-or-later.

[rclone]: https://rclone.org
[ego]: https://extensions.gnome.org
