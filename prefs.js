/* prefs.js
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Rclone from './lib/rclone.js';

export default class RcloneMounterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Mounts'),
            icon_name: 'folder-remote-symbolic',
        });

        this._mountsGroup = this._createMountsGroup(window, settings);
        page.add(this._mountsGroup);
        page.add(this._createAddMountGroup(window, settings));
        page.add(this._createOptionsGroup(settings));

        window.add(page);
    }

    _createMountsGroup(window, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Configured Mounts'),
            description: _('Mounts added here appear in the panel menu. Remotes are created with rclone config.'),
        });

        this._mountRowsParent = group;
        this._mountRows = [];
        this._mountsWindow = window;
        this._mountsSettings = settings;
        this._rebuildMountRows();

        const mountsChangedId = settings.connect(
            'changed::mountpoints', () => this._rebuildMountRows());
        window.connect('destroy', () => {
            settings.disconnect(mountsChangedId);
        });

        return group;
    }

    _rebuildMountRows() {
        const group = this._mountRowsParent;

        /* PreferencesGroup.get_first_child() is the internal header box, not a
         * row. Removing it fails and the loop never ends, which wedges the
         * org.gnome.Shell.Extensions D-Bus service so no prefs window appears. */
        for (const row of this._mountRows)
            group.remove(row);
        this._mountRows = [];

        const mountpoints = this._mountsSettings.get_value('mountpoints').deep_unpack();
        const remotes = Object.keys(mountpoints).sort();

        if (remotes.length === 0) {
            this._addMountRow(new Adw.ActionRow({
                title: _('No mounts added'),
                subtitle: _('Use Add Mount below to pick a remote from rclone listremotes.'),
            }));
            return;
        }

        for (const remote of remotes)
            this._addMountRow(this._createMountRow(this._mountsWindow, this._mountsSettings, remote, mountpoints[remote]));
    }

    _addMountRow(row) {
        this._mountRows.push(row);
        this._mountRowsParent.add(row);
    }

    _createMountRow(window, settings, remote, path) {
        const row = new Adw.ExpanderRow({
            title: remote,
            subtitle: path,
        });

        const pathRow = new Adw.EntryRow({title: _('Mount point'), text: path});
        pathRow.connect('notify::text', () => {
            Rclone.setMountpoint(settings, remote, pathRow.get_text());
            row.set_subtitle(pathRow.get_text());
        });

        const browse = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            tooltip_text: _('Choose a folder'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        browse.connect('clicked', () => this._chooseFolder(window, pathRow));
        pathRow.add_suffix(browse);
        row.add_row(pathRow);

        const loginRow = new Adw.SwitchRow({
            title: _('Mount at login'),
            active: Rclone.isMountAtLogin(settings, remote),
        });
        loginRow.connect('notify::active', () => {
            Rclone.setMountAtLogin(settings, remote, loginRow.get_active());
        });
        row.add_row(loginRow);

        const remove = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove mount'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'destructive-action'],
        });
        remove.connect('clicked', () => Rclone.removeMount(settings, remote));
        row.add_suffix(remove);

        return row;
    }

    _createAddMountGroup(window, settings) {
        const group = new Adw.PreferencesGroup({title: _('Add Mount')});

        const row = new Adw.ActionRow({
            title: _('Add a mount'),
            subtitle: _('Pick a remote from rclone listremotes and set a mount point.'),
        });

        const add = new Gtk.Button({
            label: _('Add…'),
            valign: Gtk.Align.CENTER,
        });
        add.connect('clicked', () => this._showAddMountDialog(window, settings));
        row.add_suffix(add);
        group.add(row);

        return group;
    }

    async _showAddMountDialog(window, settings) {
        let available;
        try {
            const all = await Rclone.listRemotes();
            const configured = Rclone.configuredRemotes(settings);
            available = all.filter(remote => !configured.includes(remote));
        } catch (error) {
            this._showErrorDialog(window, _('Could not list remotes'), error.message);
            return;
        }

        if (available.length === 0) {
            this._showErrorDialog(
                window,
                _('No remotes available'),
                _('Every remote from rclone listremotes is already added, or none exist. Create one with rclone config.'));
            return;
        }

        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });

        const remoteModel = Gtk.StringList.new(available);
        const remoteRow = new Adw.ComboRow({
            title: _('Remote'),
            model: remoteModel,
        });
        content.append(remoteRow);

        const pathRow = new Adw.EntryRow({
            title: _('Mount point'),
            text: Rclone.defaultMountpoint(available[0]),
        });
        remoteRow.connect('notify::selected', () => {
            const remote = available[remoteRow.get_selected()];
            pathRow.set_text(Rclone.defaultMountpoint(remote));
        });
        content.append(pathRow);

        const dialog = new Adw.Window({
            transient_for: window,
            modal: true,
            title: _('Add Mount'),
            default_width: 480,
        });

        const header = new Adw.HeaderBar();
        const cancel = Gtk.Button.new_with_label(_('Cancel'));
        cancel.connect('clicked', () => dialog.destroy());
        header.pack_start(cancel);

        const add = Gtk.Button.new_with_label(_('Add'));
        add.add_css_class('suggested-action');
        add.connect('clicked', () => {
            const remote = available[remoteRow.get_selected()];
            Rclone.addMount(settings, remote, pathRow.get_text());
            dialog.destroy();
        });
        header.pack_end(add);

        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(header);
        toolbar.set_content(content);
        dialog.set_content(toolbar);
        dialog.present();
    }

    _showErrorDialog(window, heading, body) {
        const dialog = new Adw.AlertDialog({
            heading,
            body,
            close_response: 'close',
        });
        dialog.add_response('close', _('OK'));
        dialog.present(window);
    }

    _chooseFolder(window, row) {
        const dialog = new Gtk.FileDialog({
            title: _('Select Mount Point'),
            initial_folder: Gio.File.new_for_path(row.get_text()),
        });

        dialog.select_folder(window, null, (source, result) => {
            try {
                row.set_text(source.select_folder_finish(result).get_path());
            } catch {
                /* dismissed by the user */
            }
        });
    }

    _createOptionsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Mount Options'),
            description: _('Extra flags appended to every rclone mount call.'),
        });

        const row = new Adw.EntryRow({title: _('rclone mount flags')});
        settings.bind('mount-options', row, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);

        return group;
    }
}
