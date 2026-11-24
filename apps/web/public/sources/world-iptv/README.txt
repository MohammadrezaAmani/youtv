WORLD IPTV COLLECTION
=====================

PRIMARY PLAYLIST
----------------

master/world.m3u

This is the canonical global playlist.
Use this as the main playlist in IPTV applications.

COUNTRIES
---------

countries/*.m3u

Separate country playlists.
Use these as country-specific views.

REGIONS
-------

regions/*.m3u

Regional playlists.
These overlap with countries and other regions.
Never append them to master/world.m3u.

INDEXES
-------

indexes/*.m3u

Country, region, language and category indexes.
These are navigation catalogs, not additional streams
to append to the master playlist.

SPECIAL
-------

special/international.m3u

Internationally broadcast channels.

QUARANTINE
----------

quarantine/undefined-country.m3u

Channels without a known broadcast country.
Keep separate until their metadata is verified.

CONFLICT POLICY
---------------

1. Do not merge country and regional playlists.
2. Do not merge language and category playlists.
3. Use master/world.m3u as the canonical global source.
4. Preserve the original tvg-id and group-title.
5. Keep alternate providers separate.
6. Never identify a channel by display name alone.
