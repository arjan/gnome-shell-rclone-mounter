/* lib/rclone.js
 *
 * Reading the rclone configuration and driving rclone mount/unmount.
 * Imported by both the shell and the preferences process, so it must not
 * import St, Clutter, Gtk, Gdk or Adw.
 *
 * Generated with AI for personal use.
 * Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
 * and can maintain this code.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/* Filesystem types rclone registers itself as in /proc/self/mounts. */
const RCLONE_FSTYPES = ['fuse.rclone', 'rclone'];

const MOUNTS_FILE = '/proc/self/mounts';

function readTextFile(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

/**
 * @returns {string} path of the rclone configuration file, whether or not it exists
 */
export function configPath() {
    const fromEnv = GLib.getenv('RCLONE_CONFIG');
    if (fromEnv)
        return fromEnv;

    const candidates = [
        GLib.build_filenamev([GLib.get_user_config_dir(), 'rclone', 'rclone.conf']),
        GLib.build_filenamev([GLib.get_home_dir(), '.rclone.conf']),
    ];

    return candidates.find(path => GLib.file_test(path, GLib.FileTest.EXISTS)) ?? candidates[0];
}

/**
 * Parses the remote definitions out of rclone.conf. The file is a plain INI
 * file where every section is one remote; mount points are not part of it.
 *
 * @returns {{name: string, type: string}[]} remotes in configuration file order
 */
export function listRemotes() {
    const contents = readTextFile(configPath());
    if (contents === null)
        return [];

    const remotes = [];
    let current = null;

    for (const rawLine of contents.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';'))
            continue;

        const section = /^\[(.+)\]$/.exec(line);
        if (section) {
            current = {name: section[1].trim(), type: ''};
            remotes.push(current);
            continue;
        }

        const type = current ? /^type\s*=\s*(.*)$/.exec(line) : null;
        if (type)
            current.type = type[1].trim();
    }

    return remotes.filter(remote => remote.name.length > 0);
}

/* /proc/self/mounts escapes spaces and friends as octal sequences. */
function unescapeMountPath(path) {
    return path.replace(/\\([0-7]{3})/g, (_match, octal) =>
        String.fromCharCode(parseInt(octal, 8)));
}

/**
 * @returns {Set<string>} directories currently holding an rclone mount
 */
export function activeMounts() {
    const mounted = new Set();
    const contents = readTextFile(MOUNTS_FILE);
    if (contents === null)
        return mounted;

    for (const line of contents.split('\n')) {
        const [, mountpoint, fstype] = line.split(' ');
        if (fstype && RCLONE_FSTYPES.includes(fstype))
            mounted.add(unescapeMountPath(mountpoint));
    }

    return mounted;
}

function expandHome(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

/**
 * @param {string} remote name of the remote
 * @returns {string} mount point used when none is configured
 */
export function defaultMountpoint(remote) {
    return GLib.build_filenamev([GLib.get_home_dir(), 'mnt', remote]);
}

/**
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 * @returns {string} absolute mount point for the remote
 */
export function mountpointFor(settings, remote) {
    const mountpoints = settings.get_value('mountpoints').deep_unpack();
    const configured = (mountpoints[remote] ?? '').trim();

    return configured ? expandHome(configured) : defaultMountpoint(remote);
}

/**
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 * @param {string} mountpoint mount point to store, empty to fall back to the default
 */
export function setMountpoint(settings, remote, mountpoint) {
    const mountpoints = settings.get_value('mountpoints').deep_unpack();

    if (mountpoint.trim())
        mountpoints[remote] = mountpoint.trim();
    else
        delete mountpoints[remote];

    settings.set_value('mountpoints', new GLib.Variant('a{ss}', mountpoints));
}

/**
 * @param {string} text flags as typed by the user
 * @returns {string[]} argv fragment
 */
export function parseMountOptions(text) {
    if (!text.trim())
        return [];

    try {
        const [ok, argv] = GLib.shell_parse_argv(text);
        return ok ? argv : [];
    } catch {
        return [];
    }
}

function runCommand(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) {
            reject(error);
            return;
        }

        proc.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, , stderr] = source.communicate_utf8_finish(result);
                resolve({ok: source.get_successful(), stderr});
            } catch (error) {
                reject(error);
            }
        });
    });
}

function firstProgramInPath(names) {
    for (const name of names) {
        const path = GLib.find_program_in_path(name);
        if (path)
            return path;
    }
    return null;
}

/**
 * Mounts a remote. Runs rclone with --daemon so the mount outlives the
 * GNOME Shell process that started it; rclone only exits successfully once
 * the mount is actually ready.
 *
 * @param {string} remote name of the remote
 * @param {string} mountpoint directory to mount on
 * @param {string[]} extraArgs additional rclone flags
 */
export async function mount(remote, mountpoint, extraArgs = []) {
    const rclone = firstProgramInPath(['rclone']);
    if (!rclone)
        throw new Error('rclone was not found in PATH');

    if (GLib.mkdir_with_parents(mountpoint, 0o700) !== 0)
        throw new Error(`Could not create ${mountpoint}`);

    const {ok, stderr} = await runCommand([
        rclone, 'mount', '--daemon', `${remote}:`, mountpoint, ...extraArgs,
    ]);

    if (!ok)
        throw new Error(stderr.trim() || 'rclone mount failed');
}

/**
 * Unmounts a mount point. A plain unmount regularly fails with EBUSY because
 * something on the desktop (file manager, indexer) still holds the mount, so
 * fall back to detaching it lazily.
 *
 * @param {string} mountpoint directory to unmount
 */
export async function unmount(mountpoint) {
    const fusermount = firstProgramInPath(['fusermount3', 'fusermount']);
    if (!fusermount)
        throw new Error('fusermount was not found in PATH');

    const attempts = [
        [fusermount, '-u', mountpoint],
        [fusermount, '-u', '-z', mountpoint],
    ];

    let lastError = '';
    for (const argv of attempts) {
        const {ok, stderr} = await runCommand(argv);
        if (ok)
            return;
        lastError = stderr.trim();
    }

    throw new Error(lastError || `Could not unmount ${mountpoint}`);
}
