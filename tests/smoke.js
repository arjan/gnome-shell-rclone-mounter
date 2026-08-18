#!/usr/bin/env -S gjs -m
/* tests/smoke.js
 *
 * Headless checks for lib/rclone.js. Runs without GNOME Shell and without
 * touching the real rclone configuration or dconf:
 *
 *     gjs -m tests/smoke.js
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HERE = GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]);
const PROJECT = GLib.path_get_dirname(HERE);

/* Point rclone at the fixture before importing the library. */
GLib.setenv('RCLONE_CONFIG', GLib.build_filenamev([HERE, 'fixtures', 'rclone.conf']), true);

const Rclone = await import(`file://${PROJECT}/lib/rclone.js`);

let failures = 0;

function check(description, actual, expected) {
    const actualText = JSON.stringify(actual);
    const expectedText = JSON.stringify(expected);

    if (actualText === expectedText) {
        print(`  ok    ${description}`);
    } else {
        print(`  FAIL  ${description}\n          expected ${expectedText}\n          actual   ${actualText}`);
        failures++;
    }
}

function memorySettings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([PROJECT, 'schemas']),
        Gio.SettingsSchemaSource.get_default(), false);

    return new Gio.Settings({
        settings_schema: source.lookup('org.gnome.shell.extensions.rclone-mounter', true),
        backend: Gio.memory_settings_backend_new(),
    });
}

print('rclone listremotes');
try {
    const remotes = await Rclone.listRemotes();
    check('lists remotes from fixture config via rclone',
        remotes,
        ['gdrive-work', 's3-backups', 'crypted']);
} catch (error) {
    print(`  FAIL  listRemotes threw: ${error.message}`);
    failures++;
}

print('configured mounts');
const settings = memorySettings();
check('configured remotes starts empty', Rclone.configuredRemotes(settings), []);

Rclone.addMount(settings, 'gdrive-work', '/mnt/work');
Rclone.addMount(settings, 's3-backups', '/mnt/backups');
check('configured remotes lists added mounts',
    Rclone.configuredRemotes(settings).sort(),
    ['gdrive-work', 's3-backups']);

print('mount points');
check('reads stored mount point',
    Rclone.mountpointFor(settings, 'gdrive-work'),
    '/mnt/work');

Rclone.setMountpoint(settings, 'gdrive-work', '~/Drive');
check('expands a leading tilde',
    Rclone.mountpointFor(settings, 'gdrive-work'),
    GLib.build_filenamev([GLib.get_home_dir(), 'Drive']));

Rclone.addMount(settings, 'tilde-test', '');
check('addMount with empty path uses default',
    Rclone.mountpointFor(settings, 'tilde-test'),
    GLib.build_filenamev([GLib.get_home_dir(), 'mnt', 'tilde-test']));

print('mount at login');
Rclone.setMountAtLogin(settings, 'gdrive-work', true);
check('mount at login can be enabled', Rclone.isMountAtLogin(settings, 'gdrive-work'), true);
Rclone.setMountAtLogin(settings, 'gdrive-work', false);
check('mount at login can be disabled', Rclone.isMountAtLogin(settings, 'gdrive-work'), false);

Rclone.setMountAtLogin(settings, 's3-backups', true);
Rclone.removeMount(settings, 's3-backups');
check('removeMount drops mount-at-login entry',
    Rclone.getMountAtLogin(settings),
    []);

print('mount flags');
check('splits flags like a shell would',
    Rclone.parseMountOptions('--vfs-cache-mode=writes --umask 002'),
    ['--vfs-cache-mode=writes', '--umask', '002']);
check('keeps quoted values together',
    Rclone.parseMountOptions('--log-file "/tmp/my mounts.log"'),
    ['--log-file', '/tmp/my mounts.log']);
check('empty flags yield no arguments', Rclone.parseMountOptions('  '), []);
check('unbalanced quotes do not throw', Rclone.parseMountOptions('--log-file "oops'), []);

print('program lookup');
const FIXTURES = GLib.build_filenamev([HERE, 'fixtures']);
const FIXTURE_BIN = GLib.build_filenamev([FIXTURES, 'bin']);

check('finds a program on PATH',
    Rclone.findProgram(['sh']),
    GLib.find_program_in_path('sh'));
check('prefers the first name that resolves',
    Rclone.findProgram(['rclone-does-not-exist', 'sh']),
    GLib.find_program_in_path('sh'));
check('falls back to extra directories',
    Rclone.findProgram(['fake-rclone'], [FIXTURE_BIN]),
    GLib.build_filenamev([FIXTURE_BIN, 'fake-rclone']));
check('ignores directories that match the name',
    Rclone.findProgram(['bin'], [FIXTURES]),
    null);
check('ignores files that are not executable',
    Rclone.findProgram(['rclone.conf'], [FIXTURES]),
    null);
check('returns null when nothing matches',
    Rclone.findProgram(['rclone-does-not-exist'], [FIXTURE_BIN]),
    null);

print('wait until populated');
const emptyDir = GLib.dir_make_tmp('rclone-mounter-XXXXXX');
const populatedDir = GLib.dir_make_tmp('rclone-mounter-XXXXXX');
const delayedDir = GLib.dir_make_tmp('rclone-mounter-XXXXXX');

try {
    await Rclone.waitUntilPopulated(emptyDir, 200);
    print('  FAIL  empty directory should time out');
    failures++;
} catch (error) {
    check('empty directory times out', error.message.startsWith('Timed out waiting for files in '), true);
}

GLib.file_set_contents(GLib.build_filenamev([populatedDir, 'ready']), 'yes');
try {
    await Rclone.waitUntilPopulated(populatedDir, 2000);
    print('  ok    returns once a file is present');
} catch (error) {
    print(`  FAIL  populated directory threw: ${error.message}`);
    failures++;
}

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
    GLib.file_set_contents(GLib.build_filenamev([delayedDir, 'later']), 'yes');
    return GLib.SOURCE_REMOVE;
});
try {
    await Rclone.waitUntilPopulated(delayedDir, 2000);
    print('  ok    waits until a file appears');
} catch (error) {
    print(`  FAIL  delayed file threw: ${error.message}`);
    failures++;
}

print('reachability');
check('existing directory is reachable', await Rclone.isReachable(populatedDir), true);
check('missing path is not reachable',
    await Rclone.isReachable('/tmp/rclone-mounter-does-not-exist'),
    false);

const disconnected = GLib.Error.new_literal(
    Gio.io_error_quark(), Gio.IOErrorEnum.NOT_CONNECTED,
    'Transport endpoint is not connected');
check('NOT_CONNECTED is a disconnected mount error',
    Rclone.isDisconnectedError(disconnected), true);
check('plain ENOTCONN message is a disconnected mount error',
    Rclone.isDisconnectedError(new Error('Transport endpoint is not connected')),
    true);
check('unrelated errors are not disconnected',
    Rclone.isDisconnectedError(new Error('rclone mount failed')),
    false);

for (const dir of [emptyDir, populatedDir, delayedDir]) {
    const children = Gio.File.new_for_path(dir).enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)) !== null)
        GLib.unlink(GLib.build_filenamev([dir, info.get_name()]));
    GLib.rmdir(dir);
}

print('live mount detection');
check('active mounts are reported as a set', Rclone.activeMounts() instanceof Set, true);

print(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
if (failures > 0)
    imports.system.exit(1);
