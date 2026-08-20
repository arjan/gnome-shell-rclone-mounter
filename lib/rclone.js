/* lib/rclone.js
 *
 * Remote listing via rclone and mount/unmount helpers.
 * Imported by both the shell and the preferences process, so it must not
 * import St, Clutter, Gtk, Gdk or Adw.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/* Filesystem types rclone registers itself as in /proc/self/mounts. */
const RCLONE_FSTYPES = ['fuse.rclone', 'rclone'];

const MOUNTS_FILE = '/proc/self/mounts';

/* GNOME Shell inherits the session PATH, which is set up before any shell rc
 * file runs, so binaries installed into a user prefix by Homebrew and friends
 * are invisible even though an interactive shell finds them. */
const EXTRA_BIN_DIRS = [
    '/home/linuxbrew/.linuxbrew/bin',
    GLib.build_filenamev([GLib.get_home_dir(), '.linuxbrew', 'bin']),
    '/opt/homebrew/bin',
    GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin']),
    '/usr/local/bin',
];

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

async function readTextFile(path) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

/**
 * @returns {string[]} remote names from `rclone listremotes`
 */
export async function listRemotes() {
    const rclone = requireProgram(['rclone']);

    const {ok, stdout, stderr} = await runCommand([rclone, 'listremotes']);
    if (!ok)
        throw new Error(stderr.trim() || 'rclone listremotes failed');

    return stdout.trim().split('\n')
        .map(line => line.trim().replace(/:$/, ''))
        .filter(name => name.length > 0);
}

/* /proc/self/mounts escapes spaces and friends as octal sequences. */
function unescapeMountPath(path) {
    return path.replace(/\\([0-7]{3})/g, (_match, octal) =>
        String.fromCharCode(parseInt(octal, 8)));
}

/**
 * @returns {Promise<Set<string>>} directories currently holding an rclone mount
 */
export async function activeMounts() {
    const mounted = new Set();
    const contents = await readTextFile(MOUNTS_FILE);
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
 * @returns {string[]} remote names with a configured mount
 */
export function configuredRemotes(settings) {
    return Object.keys(settings.get_value('mountpoints').deep_unpack());
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
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 * @param {string} mountpoint directory path, or empty for the default
 */
export function addMount(settings, remote, mountpoint) {
    const path = mountpoint.trim() || defaultMountpoint(remote);
    setMountpoint(settings, remote, path);
}

/**
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 */
export function removeMount(settings, remote) {
    const mountpoints = settings.get_value('mountpoints').deep_unpack();
    delete mountpoints[remote];
    settings.set_value('mountpoints', new GLib.Variant('a{ss}', mountpoints));
    setMountAtLogin(settings, remote, false);
}

/**
 * @param {Gio.Settings} settings extension settings
 * @returns {string[]} remotes marked to mount when the extension starts
 */
export function getMountAtLogin(settings) {
    return settings.get_strv('mount-at-login');
}

/**
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 * @returns {boolean}
 */
export function isMountAtLogin(settings, remote) {
    return getMountAtLogin(settings).includes(remote);
}

/**
 * @param {Gio.Settings} settings extension settings
 * @param {string} remote name of the remote
 * @param {boolean} enabled whether to mount this remote at login
 */
export function setMountAtLogin(settings, remote, enabled) {
    const list = getMountAtLogin(settings);
    const index = list.indexOf(remote);

    if (enabled && index === -1)
        list.push(remote);
    else if (!enabled && index !== -1)
        list.splice(index, 1);

    settings.set_strv('mount-at-login', list);
}

/**
 * @param {string} mountpoint directory to open in the file manager
 */
export function openInFiles(mountpoint) {
    const uri = GLib.filename_to_uri(mountpoint, null);
    Gio.AppInfo.launch_default_for_uri(uri, null);
}

/**
 * rclone can die while the kernel still lists the FUSE mount. Access then
 * fails with ENOTCONN ("Transport endpoint is not connected").
 *
 * @param {Error} error
 * @returns {boolean}
 */
export function isDisconnectedError(error) {
    if (error.message.includes('Transport endpoint is not connected'))
        return true;

    return error instanceof Gio.IOErrorEnum && (
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_CONNECTED) ||
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED));
}

/**
 * @param {string} path directory to probe
 * @param {Gio.Cancellable} [cancellable]
 * @returns {Promise<boolean>}
 */
export async function isReachable(path, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    try {
        await file.query_info_async(
            'standard::type', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable);
        return true;
    } catch (error) {
        if (cancellable && cancellable.is_cancelled())
            throw error;
        return false;
    }
}

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

function delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * @param {string} path directory to inspect
 * @param {Gio.Cancellable} [cancellable]
 * @returns {Promise<boolean>}
 */
export async function directoryHasEntries(path, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    let enumerator;
    try {
        enumerator = await file.enumerate_children_async(
            'standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (cancellable && cancellable.is_cancelled())
            throw error;
        return false;
    }

    try {
        const files = await enumerator.next_files_async(
            1, GLib.PRIORITY_DEFAULT, cancellable);
        return files.length > 0;
    } catch (error) {
        if (cancellable && cancellable.is_cancelled())
            throw error;
        return false;
    } finally {
        enumerator.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
    }
}

/**
 * rclone --daemon can return before readdir works, so opening Files at that
 * point often shows the empty pre-mount directory.
 *
 * @param {string} mountpoint directory that should gain entries
 * @param {number} [timeoutMs]
 * @param {Gio.Cancellable} [cancellable]
 */
export async function waitUntilPopulated(mountpoint, timeoutMs = 30000, cancellable = null) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;

    while (true) {
        if (cancellable && cancellable.is_cancelled())
            throw new Error('Cancelled');

        if (await directoryHasEntries(mountpoint, cancellable))
            return;

        if (cancellable && cancellable.is_cancelled())
            throw new Error('Cancelled');

        if (GLib.get_monotonic_time() >= deadline)
            throw new Error(`Timed out waiting for files in ${mountpoint}`);

        await delay(250);
    }
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
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                resolve({
                    ok: source.get_successful(),
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * @param {string[]} names candidate program names, most preferred first
 * @param {string[]} extraDirs directories to search when PATH comes up empty
 * @returns {?string} absolute path of the first program found
 */
export function findProgram(names, extraDirs = EXTRA_BIN_DIRS) {
    for (const name of names) {
        const onPath = GLib.find_program_in_path(name);
        if (onPath)
            return onPath;

        for (const dir of extraDirs) {
            const candidate = GLib.build_filenamev([dir, name]);
            /* Directories pass IS_EXECUTABLE, so rule them out explicitly. */
            if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE) &&
                !GLib.file_test(candidate, GLib.FileTest.IS_DIR))
                return candidate;
        }
    }

    return null;
}

function requireProgram(names) {
    const program = findProgram(names);
    if (!program) {
        throw new Error(
            `${names[0]} was not found in PATH (${GLib.getenv('PATH')}) ` +
            `or in ${EXTRA_BIN_DIRS.join(', ')}`);
    }

    return program;
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
    const rclone = requireProgram(['rclone']);

    if ((await activeMounts()).has(mountpoint)) {
        /* A dead rclone process leaves fuse.rclone in /proc/self/mounts with
         * ENOTCONN on access. Tear that down before mounting again. */
        if (await isReachable(mountpoint))
            return;
        await unmount(mountpoint);
    }

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
    const fusermount = requireProgram(['fusermount3', 'fusermount']);

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
