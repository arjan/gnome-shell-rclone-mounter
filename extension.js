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

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Rclone from './lib/rclone.js';
import {Indicator} from './shell/indicator.js';

export default class RcloneMounterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new Indicator(this._settings, () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._mountAtLogin();
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    async _mountAtLogin() {
        const loginRemotes = Rclone.getMountAtLogin(this._settings);
        const mountpoints = this._settings.get_value('mountpoints').deep_unpack();
        const mounted = await Rclone.activeMounts();
        const options = Rclone.parseMountOptions(this._settings.get_string('mount-options'));

        for (const remote of loginRemotes) {
            if (!mountpoints[remote])
                continue;

            const mountpoint = Rclone.mountpointFor(this._settings, remote);
            if (mounted.has(mountpoint))
                continue;

            try {
                await Rclone.mount(remote, mountpoint, options);
            } catch (error) {
                Main.notifyError(
                    _('Could not mount remote at login'),
                    `${remote}: ${error.message}`);
                console.error(`rclone-mounter: ${error.message}`);
            }
        }
    }
}
