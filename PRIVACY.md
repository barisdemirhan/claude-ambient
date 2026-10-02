# Privacy

What the Ambient mod for Claude Code does with data. Last changed on 2 October 2026.

## If you never name a place

Nothing leaves your machine. The mod makes no network request.

While the band is on, the mod reads the name of each tool Claude calls and whether the call failed, to move the scene and sound it. It reads nothing of a call's arguments or output, and it notes when a turn starts and ends. The counts it keeps of these live in the session and are gone with it.

In the plugin's own Claude Code store, on your disk, it keeps:

- Your settings: the scene, whether the band and the sound are on, the volume, the rows, when the band shows, shuffle and the hint line.
- The bonsai: its seed, the turns it has seen, the leaves it shed.
- Today's skyline: the date and the number of edits Claude made.
- Which of your open sessions plays the sound: a random id made when the mod loads and the time it last said so. It is removed when the sound goes off or the session ends.

## If you name a place for the weather

`/ambient weather <city>` and `/ambient weather auto` make the weather scene follow the real sky. This is off until you run one of them, and it is the only thing in the mod that makes a network request. The requests go to [Open-Meteo](https://open-meteo.com/), a weather service the author of this mod does not run.

What is sent:

- **Once, when you name the place:** the name you typed, to `geocoding-api.open-meteo.com`, to learn where the place is. With `auto` the name is the city your machine's time zone is named for (`Istanbul` for `Europe/Istanbul`); nothing else about your machine or where you are is read.
- **Then every quarter of an hour, while a session is open:** the place's latitude and longitude, to `api.open-meteo.com`, to learn the weather there now.

As with any request, Open-Meteo's servers see the address the request comes from. What they do with requests is in [their terms](https://open-meteo.com/en/terms).

What comes back (the weather code, day or night, the temperature) is shown in the scene and kept for the session. The place's name and coordinates are kept with your settings, on your disk.

Nothing is sent to the author of this mod, in either case. The mod has no server, no account and no analytics.

## Taking your data off

`/ambient weather off` forgets the place and stops the requests at once. Everything else the mod keeps is on your own disk, in the plugin's store, and goes when you remove the plugin's data.

If something here is unclear or wrong, [open an issue](https://github.com/barisdemirhan/claude-ambient/issues).

## Changes

This file's history in the repository is the record of what changed and when.
