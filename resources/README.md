# Browser resources

`adblock.bin.gz` is a serialized Ghostery filtering engine containing EasyList and
EasyPrivacy. It provides offline filtering on first launch. `adblock.json` records
its fetch time, source URLs, and engine version.

The original lists are published at https://easylist.to/easylist/easylist.txt and
https://easylist.to/easylist/easyprivacy.txt. EasyList and EasyPrivacy are available
under GPL-3.0-or-later or CC-BY-SA-3.0; this distribution uses CC-BY-SA-3.0.
Attribution: EasyList authors (https://easylist.to/). The snapshot is transformed
into Ghostery's binary format. License: https://creativecommons.org/licenses/by-sa/3.0/.

Run `node scripts/update-filters.mjs` to refresh the bundled snapshot. Regular
builds do not download filters. The installed browser updates its separate cache
in the background when automatic updates are enabled.

Ghostery's engine is MPL-2.0. Dark Reader is MIT. Both packages retain their license
files in the packaged application. Browser integration uses network filtering and
CSS hiding without a privileged page preload. Filter scriptlets, HTML rewriting,
and extended cosmetic selectors are not enabled.
