/* shell/indicator.js
 *
 * Panel indicator, loaded by the GNOME Shell process only.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Rclone from '../lib/rclone.js';

const SPINNER_SIZE = 16;

function showErrorDialog(title, description) {
    const dialog = new ModalDialog.ModalDialog();
    dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
        title,
        description,
    }));
    dialog.addButton({
        label: _('Close'),
        action: () => dialog.close(),
        default: true,
        key: Clutter.KEY_Escape,
    });
    dialog.open();
}

const RemoteMenuItem = GObject.registerClass({
    Signals: {
        'open': {},
        'mount': {},
        'unmount': {},
    },
}, class RemoteMenuItem extends PopupMenu.PopupMenuItem {
    _init(name) {
        super._init(name);

        this._mounted = false;
        this._busy = false;

        this._spinner = new Animation.Spinner(SPINNER_SIZE, {hideOnStop: true});
        this._ejectIcon = new St.Icon({
            icon_name: 'media-eject-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._ejectButton = new St.Button({
            child: this._ejectIcon,
            style_class: 'rclone-eject-button',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ejectButton.accessible_name = _('Unmount');
        this._ejectButton.connect('clicked', () => {
            if (!this._busy)
                this.emit('unmount');
        });

        this._statusBin = new St.Bin({
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusBox = new St.BoxLayout();
        this._statusBox.add_child(this._spinner);
        this._statusBox.add_child(this._ejectButton);
        this._statusBin.child = this._statusBox;
        this.add_child(this._statusBin);

        this._ejectHoverId =
            this._ejectButton.connect('notify::hover', () => this._syncClickGesture());
        this._updateAccessory();
        this._syncClickGesture();
    }

    setMounted(mounted) {
        this._mounted = mounted;
        this._updateAccessory();
        this._syncClickGesture();
    }

    setBusy(busy) {
        this._busy = busy;
        this._updateAccessory();
        this._syncClickGesture();
    }

    activate(_event) {
        if (this._busy || this._ejectButton.hover)
            return;

        /* Emitting 'activate' closes the menu. Keep it open while mounting so
         * the spinner stays visible; opening Files is the only close-the-menu
         * action. */
        if (this._mounted)
            this.emit('open');
        else
            this.emit('mount');
    }

    _updateAccessory() {
        if (this._busy) {
            this._ejectButton.visible = false;
            this._spinner.play();
            return;
        }

        this._spinner.stop();
        this._ejectButton.visible = this._mounted;
    }

    _syncClickGesture() {
        this._clickGesture.enabled =
            this._activatable && !this._busy && !this._ejectButton.hover;
    }

    destroy() {
        this._ejectButton.disconnect(this._ejectHoverId);
        this._spinner.stop();
        super.destroy();
    }
});

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(settings, openPreferences) {
        super._init(0.0, _('Rclone Mounter'));

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._remotes = new Map();
        this._pending = new Map();

        this._icon = new St.Icon({
            icon_name: 'folder-remote-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._mountMonitor = Gio.UnixMountMonitor.get();
        this._mountsChangedId =
            this._mountMonitor.connect('mounts-changed', () => this._syncMountStates());

        this._settingsChangedId =
            this._settings.connect('changed::mountpoints', () => this._rebuildMenu());

        this._rebuildMenu();
    }

    _rebuildMenu() {
        this.menu.removeAll();
        this._remotes.clear();

        const remotes = Rclone.configuredRemotes(this._settings);
        if (remotes.length === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                _('No mounts added'), {reactive: false}));
        }

        for (const remote of remotes.sort()) {
            const mountpoint = Rclone.mountpointFor(this._settings, remote);
            const item = new RemoteMenuItem(remote);
            item.connect('open', () => this._openRemote(remote));
            item.connect('mount', () => this._mountRemote(remote));
            item.connect('unmount', () => this._unmountRemote(remote));
            this.menu.addMenuItem(item);

            this._remotes.set(remote, {item, mountpoint});
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const preferences = new PopupMenu.PopupMenuItem(_('Manage Mounts…'));
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
            remote.item.setMounted(isMounted);
            remote.item.setBusy(this._pending.has(name));
            anyMounted ||= isMounted;
        }

        if (anyMounted)
            this._icon.add_style_class_name('rclone-mounted');
        else
            this._icon.remove_style_class_name('rclone-mounted');
    }

    async _openRemote(name) {
        const remote = this._remotes.get(name);
        try {
            Rclone.openInFiles(remote.mountpoint);
            this.menu.close();
        } catch (error) {
            if (Rclone.isDisconnectedError(error)) {
                await this._mountRemote(name);
                return;
            }

            this.menu.close();
            showErrorDialog(_('Could not open remote'), `${name}: ${error.message}`);
            console.error(`rclone-mounter: ${error.message}`);
        }
    }

    async _mountRemote(name) {
        if (this._pending.has(name))
            return;

        const remote = this._remotes.get(name);
        const cancellable = new Gio.Cancellable();
        this._pending.set(name, cancellable);
        this._syncMountStates();

        try {
            const options = Rclone.parseMountOptions(
                this._settings.get_string('mount-options'));
            await Rclone.mount(name, remote.mountpoint, options);
            await Rclone.waitUntilPopulated(remote.mountpoint, 30000, cancellable);
            if (cancellable.is_cancelled())
                return;

            this.menu.close();
            Rclone.openInFiles(remote.mountpoint);
        } catch (error) {
            if (cancellable.is_cancelled())
                return;

            this.menu.close();
            showErrorDialog(_('Could not mount remote'), `${name}: ${error.message}`);
            console.error(`rclone-mounter: ${error.message}`);
        } finally {
            this._pending.delete(name);
            if (!cancellable.is_cancelled())
                this._syncMountStates();
        }
    }

    async _unmountRemote(name) {
        if (this._pending.has(name))
            return;

        const remote = this._remotes.get(name);
        const cancellable = new Gio.Cancellable();
        this._pending.set(name, cancellable);
        this._syncMountStates();

        try {
            await Rclone.unmount(remote.mountpoint);
        } catch (error) {
            if (cancellable.is_cancelled())
                return;

            this.menu.close();
            showErrorDialog(_('Could not unmount remote'), `${name}: ${error.message}`);
            console.error(`rclone-mounter: ${error.message}`);
        } finally {
            this._pending.delete(name);
            if (!cancellable.is_cancelled())
                this._syncMountStates();
        }
    }

    destroy() {
        for (const cancellable of this._pending.values())
            cancellable.cancel();
        this._pending.clear();

        this._mountMonitor.disconnect(this._mountsChangedId);
        this._settings.disconnect(this._settingsChangedId);

        this._remotes.clear();
        this._settings = null;

        super.destroy();
    }
});
