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

/* Point the library at the fixture before importing it. */
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

print('rclone.conf parsing');
check('honours RCLONE_CONFIG', Rclone.configPath().endsWith('tests/fixtures/rclone.conf'), true);
check('finds every remote, trimming section names',
    Rclone.listRemotes().map(remote => remote.name),
    ['gdrive-work', 's3-backups', 'crypted']);
check('reads the backend type, ignoring extra whitespace',
    Rclone.listRemotes().map(remote => remote.type),
    ['drive', 's3', 'crypt']);

print('mount points');
const settings = memorySettings();
check('falls back to ~/mnt/<remote>',
    Rclone.mountpointFor(settings, 'gdrive-work'),
    GLib.build_filenamev([GLib.get_home_dir(), 'mnt', 'gdrive-work']));

Rclone.setMountpoint(settings, 'gdrive-work', '/mnt/work');
check('stores a configured mount point', Rclone.mountpointFor(settings, 'gdrive-work'), '/mnt/work');

Rclone.setMountpoint(settings, 'gdrive-work', '~/Drive');
check('expands a leading tilde',
    Rclone.mountpointFor(settings, 'gdrive-work'),
    GLib.build_filenamev([GLib.get_home_dir(), 'Drive']));

Rclone.setMountpoint(settings, 'gdrive-work', '   ');
check('blank input clears the entry',
    settings.get_value('mountpoints').deep_unpack(), {});

print('mount flags');
check('splits flags like a shell would',
    Rclone.parseMountOptions('--vfs-cache-mode=writes --umask 002'),
    ['--vfs-cache-mode=writes', '--umask', '002']);
check('keeps quoted values together',
    Rclone.parseMountOptions('--log-file "/tmp/my mounts.log"'),
    ['--log-file', '/tmp/my mounts.log']);
check('empty flags yield no arguments', Rclone.parseMountOptions('  '), []);
check('unbalanced quotes do not throw', Rclone.parseMountOptions('--log-file "oops'), []);

print('live mount detection');
check('active mounts are reported as a set', Rclone.activeMounts() instanceof Set, true);

print(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
if (failures > 0)
    imports.system.exit(1);
