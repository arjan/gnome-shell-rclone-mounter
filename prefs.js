/* prefs.js
 *
 * Generated with AI for personal use.
 * Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
 * and can maintain this code.
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

        page.add(this._createRemotesGroup(window, settings));
        page.add(this._createOptionsGroup(settings));

        window.add(page);
    }

    _createRemotesGroup(window, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Remotes'),
            description: _('Mount points are not stored in rclone.conf, so choose one for each remote here.'),
        });

        const remotes = Rclone.listRemotes();
        if (remotes.length === 0) {
            group.add(new Adw.ActionRow({
                title: _('No remotes found'),
                subtitle: Rclone.configPath(),
            }));
            return group;
        }

        for (const remote of remotes)
            group.add(this._createRemoteRow(window, settings, remote));

        return group;
    }

    _createRemoteRow(window, settings, remote) {
        const row = new Adw.EntryRow({
            title: remote.type ? `${remote.name}  ·  ${remote.type}` : remote.name,
            text: Rclone.mountpointFor(settings, remote.name),
        });

        const browse = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            tooltip_text: _('Choose a folder'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        browse.connect('clicked', () => this._chooseFolder(window, row));
        row.add_suffix(browse);

        row.connect('notify::text',
            () => Rclone.setMountpoint(settings, remote.name, row.get_text()));

        return row;
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
