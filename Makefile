UUID     := gnome-shell-rclone-mounter@github.com
EXTDIR   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA   := schemas/gschemas.compiled

.PHONY: help schemas lint test check install uninstall enable disable prefs nested logs pack clean

help:
	@echo 'make schemas    compile the GSettings schema (required after schema edits)'
	@echo 'make lint       run eslint'
	@echo 'make test       run the headless gjs test suite'
	@echo 'make check      schemas + lint + test'
	@echo 'make install    symlink this checkout into the GNOME extensions directory'
	@echo 'make uninstall  remove that symlink'
	@echo 'make enable     enable the extension (needs it to be known to the shell)'
	@echo 'make prefs      open the preferences window'
	@echo 'make nested     run a nested GNOME Shell to test without logging out'
	@echo 'make logs       follow gnome-shell log output for this extension'
	@echo 'make pack       build a distributable zip'

schemas: $(SCHEMA)

$(SCHEMA): schemas/*.gschema.xml
	glib-compile-schemas schemas/

lint:
	npx eslint .

test: schemas
	gjs -m tests/smoke.js

check: schemas lint test

install:
	mkdir -p $(dir $(EXTDIR))
	ln -sfn $(CURDIR) $(EXTDIR)
	@echo 'Linked. On Wayland, log out and back in for the shell to notice it.'

uninstall:
	rm -f $(EXTDIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

# GNOME 49+ uses the Mutter Development Kit instead of --nested (removed with X11).
MUTTER_DEVKIT := /usr/libexec/mutter-devkit

# dbus-run-session has no gnome-keyring. xdg-desktop-portal then waits ~25s for
# org.freedesktop.secrets; this stub makes activation fail immediately.
NESTED_DATA := $(CURDIR)/dev

nested:
	@if [ ! -x '$(MUTTER_DEVKIT)' ]; then \
		echo 'mutter-devkit is not installed (expected at $(MUTTER_DEVKIT)).'; \
		echo 'On Ubuntu: sudo apt install mutter-dev-bin'; \
		exit 1; \
	fi
	@echo 'Starting nested GNOME Shell via mutter-devkit...'
	GTK_A11Y=none \
	ADW_DISABLE_PORTAL=1 \
	GDK_DEBUG=no-portals \
	XDG_DATA_DIRS='$(NESTED_DATA):$(or $(XDG_DATA_DIRS),/usr/local/share:/usr/share)' \
	dbus-run-session -- gnome-shell --devkit --wayland

logs:
	journalctl -f -o cat --since now /usr/bin/gnome-shell

pack: schemas
	gnome-extensions pack --force \
		--extra-source=lib \
		--extra-source=shell \
		-o .

clean:
	rm -f $(SCHEMA) *.shell-extension.zip
