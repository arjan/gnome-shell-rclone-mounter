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

# A nested shell picks up code changes without ending the session. Wayland only.
nested:
	dbus-run-session -- gnome-shell --nested --wayland

logs:
	journalctl -f -o cat --since now /usr/bin/gnome-shell

pack: schemas
	gnome-extensions pack --force \
		--extra-source=lib \
		--extra-source=shell \
		-o .

clean:
	rm -f $(SCHEMA) *.shell-extension.zip
