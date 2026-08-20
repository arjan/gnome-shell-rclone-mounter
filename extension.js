/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Rclone from './lib/rclone.js';
import {Indicator} from './shell/indicator.js';

export default class RcloneMounterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._indicator = new Indicator(this._settings, () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._mountAtLogin();
    }

    disable() {
        this._cancellable.cancel();
        this._cancellable = null;
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
        Rclone.clearDelays();
    }

    async _mountAtLogin() {
        const settings = this._settings;
        const cancellable = this._cancellable;
        const loginRemotes = Rclone.getMountAtLogin(settings);
        const mountpoints = settings.get_value('mountpoints').deep_unpack();
        const mounted = await Rclone.activeMounts(cancellable);
        if (cancellable.is_cancelled())
            return;

        const options = Rclone.parseMountOptions(settings.get_string('mount-options'));

        for (const remote of loginRemotes) {
            if (cancellable.is_cancelled())
                return;
            if (!mountpoints[remote])
                continue;

            const mountpoint = Rclone.mountpointFor(settings, remote);
            if (mounted.has(mountpoint))
                continue;

            try {
                await Rclone.mount(remote, mountpoint, options);
            } catch (error) {
                if (cancellable.is_cancelled())
                    return;
                Main.notifyError(
                    _('Could not mount remote at login'),
                    `${remote}: ${error.message}`);
                console.error(`rclone-mounter: ${error.message}`);
            }
        }
    }
}
