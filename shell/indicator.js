/* shell/indicator.js
 *
 * Panel indicator, loaded by the GNOME Shell process only.
 *
 * Generated with AI for personal use.
 * Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
 * and can maintain this code.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Rclone from '../lib/rclone.js';

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(settings, openPreferences) {
        super._init(0.0, _('Rclone Mounter'));

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._remotes = new Map();
        this._busy = new Set();

        this._icon = new St.Icon({
            icon_name: 'folder-remote-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._mountMonitor = Gio.UnixMountMonitor.get();
        this._mountsChangedId =
            this._mountMonitor.connect('mounts-changed', () => this._syncMountStates());

        this._configMonitor = Gio.File.new_for_path(Rclone.configPath())
            .monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._configChangedId =
            this._configMonitor.connect('changed', () => this._rebuildMenu());

        this._settingsChangedId =
            this._settings.connect('changed::mountpoints', () => this._rebuildMenu());

        this._rebuildMenu();
    }

    _rebuildMenu() {
        this.menu.removeAll();
        this._remotes.clear();

        const remotes = Rclone.listRemotes();
        if (remotes.length === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                _('No rclone remotes configured'), {reactive: false}));
        }

        for (const remote of remotes) {
            const item = new PopupMenu.PopupSwitchMenuItem(remote.name, false);
            item.connect('toggled', (_item, state) => this._setMounted(remote.name, state));
            this.menu.addMenuItem(item);

            this._remotes.set(remote.name, {
                item,
                mountpoint: Rclone.mountpointFor(this._settings, remote.name),
            });
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const preferences = new PopupMenu.PopupMenuItem(_('Mount Points…'));
        preferences.connect('activate', () => this._openPreferences());
        this.menu.addMenuItem(preferences);

        this._syncMountStates();
    }

    /* Mount state is always derived from the kernel, never cached, so mounts
     * made outside this extension are reflected too. */
    _syncMountStates() {
        const mounted = Rclone.activeMounts();
        let anyMounted = false;

        for (const [name, remote] of this._remotes) {
            const isMounted = mounted.has(remote.mountpoint);
            remote.item.setToggleState(isMounted);
            remote.item.sensitive = !this._busy.has(name);
            anyMounted ||= isMounted;
        }

        if (anyMounted)
            this._icon.add_style_class_name('rclone-mounted');
        else
            this._icon.remove_style_class_name('rclone-mounted');
    }

    async _setMounted(name, shouldMount) {
        const remote = this._remotes.get(name);

        this._busy.add(name);
        this._syncMountStates();

        try {
            if (shouldMount) {
                const options = Rclone.parseMountOptions(
                    this._settings.get_string('mount-options'));
                await Rclone.mount(name, remote.mountpoint, options);
            } else {
                await Rclone.unmount(remote.mountpoint);
            }
        } catch (error) {
            Main.notifyError(
                shouldMount ? _('Could not mount remote') : _('Could not unmount remote'),
                `${name}: ${error.message}`);
            console.error(`rclone-mounter: ${error.message}`);
        } finally {
            this._busy.delete(name);
            this._syncMountStates();
        }
    }

    destroy() {
        this._mountMonitor.disconnect(this._mountsChangedId);
        this._configMonitor.disconnect(this._configChangedId);
        this._configMonitor.cancel();
        this._settings.disconnect(this._settingsChangedId);

        this._remotes.clear();
        this._settings = null;

        super.destroy();
    }
});
