# Rclone Mounter

A GNOME Shell extension that mounts and unmounts [rclone][rclone] remotes from a
panel menu. Remotes are created with `rclone config`; here you choose which ones
to mount and where.

For a more complete rclone client — file watch/sync, per-profile status, an
event log, and rclone.conf backup — see [RClone Manager][rclone-manager].

## Requirements

- GNOME Shell 49
- `rclone` (developed against 1.75)
- `fusermount3` (or `fusermount`), part of the `fuse3` package

GNOME Shell inherits the session `PATH`, which is set before any shell rc file
runs, so a `PATH` exported from `~/.zshrc` or `~/.bashrc` does not reach the
extension. Binaries are looked up on `PATH` first and then in
`/home/linuxbrew/.linuxbrew/bin`, `~/.linuxbrew/bin`, `/opt/homebrew/bin`,
`~/.local/bin` and `/usr/local/bin`. For an install somewhere else, add its
directory to the session `PATH` with a
[`~/.config/environment.d/*.conf`][envd] drop-in and log out and back in.
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

1. Open preferences (`make prefs` or **Manage Mounts…** in the panel menu).
2. Click **Add Mount**, pick a remote from `rclone listremotes`, and set a mount
   point (defaults to `~/mnt/<remote-name>`).
3. Use the panel icon to mount or unmount. An unmounted row is a plain menu
   item: click it to mount (a spinner shows until the folder has files, then
   Files opens). A mounted row has an eject icon; click the name to open Files,
   or eject to unmount.

The icon picks up the accent colour while anything is mounted.

Mount points are stored in the extension settings, not in `rclone.conf` — see
[Why mount points are configured here](#why-mount-points-are-configured-here).

**Mount at login:** enable per mount in preferences; remotes marked this way are
mounted when the extension starts (after login or shell reload).

**Open in Files:** a successful mount opens the folder automatically. Click a
mounted remote's name to open it again.

Global **mount options** (default `--vfs-cache-mode=writes`) apply to every
mount. Anything `rclone mount` accepts works, for example `--read-only`,
`--umask 002` or `--bwlimit 1M`.

## Why mount points are configured here

`rclone.conf` describes only *what* a remote is — its backend type and
credentials. There is no key for a target directory, because the mount point is
an argument to `rclone mount`. The extension calls `rclone listremotes` to list
available remotes when you add a mount, and stores the *where* in GSettings
(`mountpoints`, a remote-name to directory map).

## How it works

- **Available remotes** come from `rclone listremotes` when you add a mount in
  preferences. The panel only shows remotes you have explicitly added.
- **State** is always read from `/proc/self/mounts`, looking for the
  `fuse.rclone` filesystem type, and refreshed from `Gio.UnixMountMonitor`.
  Nothing is cached, so mounts made outside the extension still show as mounted.
- **Mounting** runs `rclone mount --daemon`, then waits until the mount point
  lists at least one file before opening Files. Failures are shown in a dialog
  with rclone's error. The mount survives a GNOME Shell restart. If rclone has
  died and left a disconnected FUSE mount, clicking the row tears that down and
  mounts again.
- **Unmounting** calls `fusermount -u`, falling back to lazy `-u -z` when the
  mount is still busy.

## Development

```bash
make check    # compile schemas, lint, run tests
make test     # headless test suite, no GNOME Shell needed
make lint     # eslint (npm install first)
make logs     # follow gnome-shell output
make nested   # nested devkit shell (GNOME 49+: needs mutter-dev-bin on Ubuntu)
make pack     # distributable zip
```

`make nested` starts a nested GNOME Shell via the Mutter Development Kit
(`gnome-shell --devkit --wayland`). On GNOME 49, `--nested` was removed; install
`mutter-dev-bin` on Ubuntu if the command complains about a missing
`mutter-devkit`.

The test suite (`tests/smoke.js`) runs under plain `gjs` with a fixture
`rclone.conf` (via `RCLONE_CONFIG`) and an in-memory GSettings backend.

### Layout

| Path | Process | Notes |
| --- | --- | --- |
| `extension.js` | shell | Entry point; mount-at-login on `enable()` |
| `shell/indicator.js` | shell | Panel menu, mount/unmount, Open in Files |
| `prefs.js` | preferences | Add Mount, mount list, login toggles |
| `lib/rclone.js` | both | `listremotes`, mount state, mount/unmount |
| `schemas/` | — | GSettings schema |
| `tests/` | — | Headless gjs checks |

`lib/rclone.js` must never import `St`, `Clutter`, `Gtk`, `Gdk` or `Adw`.

### Agentic development

`best-practices.md` is the upstream GNOME/EGO guidance. Cursor rules in
`.cursor/rules/` encode conventions and verification. Run `make check` before
reporting work done.

When testing mounts, never disturb a mount you did not create — use a scratch
read-only mount and lazy-unmount it afterwards.

## Caveats

- Encrypted rclone configurations are not supported; there is nowhere to enter
  the config password.
- A mount that dies on its own is reflected in the menu, but you are not
  notified about it.
- Mount flags are global rather than per remote.
- Remotes are always mounted at their root, not at a subpath.

## Later extras

systemd user units, per-remote flags, `rclone about`, encrypted config password
prompts, live transfer stats, keyboard shortcuts, subpath mounts, translations.

## Publishing

`make pack` builds a zip that can be submitted to
[extensions.gnome.org][ego].

## License

This program is free software under the [GNU General Public License v2.0 or
later](LICENSE) (`GPL-2.0-or-later`).

[rclone]: https://rclone.org
[rclone-manager]: https://github.com/germanztz/gnome-shell-extension-rclone-manager
[ego]: https://extensions.gnome.org
[envd]: https://www.freedesktop.org/software/systemd/man/latest/environment.d.html
