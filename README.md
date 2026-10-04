# claude-ambient

A living band above the prompt in [Claude Code](https://claude.com/claude-code), fed by Claude's work. Eleven scenes in one mod, each with its own sound: pick the one you want to watch, and hear, while Claude works.

Type `/ambient` and pick a scene. **[See and hear the scenes in your browser](https://barisdemirhan.github.io/claude-ambient/)**: the page runs the mod's own scenes and plays its own sounds.

## Install

```sh
claude plugin marketplace add barisdemirhan/claude-ambient
claude plugin install ambient@claude-ambient
```

Restart Claude Code, then run `/ambient`.

## Scenes

| Scene | What you see | What Claude's work does to it |
| --- | --- | --- |
| `aquarium` | A fish tank lit from above: sand, rocks, coral, swaying weed and bubbles | Every tool call is a fish of its kind (reads are minnows, shell calls are crabs, web calls are jellyfish, agents are whales). A failed call brings the shark and the fish flee. When the turn ends, it is feeding time |
| `bonsai` | A bonsai in a glazed pot, in a garden with hills and a stone lantern, under the sky of your clock | It grows a little every finished turn and lives on between sessions. A failed call sheds leaves, which grow back. The leaves follow the season on your clock, flowers sprout around it, and a grown tree bears fruit |
| `city` | A street that becomes a skyline, a far city behind it, under the sky of your clock | Every edit adds a floor. The skyline is kept for the day and starts over the next morning. Other calls are traffic, a failed call is a blackout, and a turn that built something ends with fireworks. Sun, moon and lit windows follow your clock |
| `stars` | A night sky with the Milky Way, over dark hills and pines | Every tool call is a star in its kind's color, every turn a constellation that gets a name when the turn ends. A failed call's star falls |
| `weather` | Hills, a house with a smoking chimney, trees, and a sun or moon that crosses the sky with your clock | Failures gather a storm: clouds, rain, then lightning. Clean calls calm it, and when the rain has passed there is a rainbow. It snows in winter |
| `train` | A steam engine on a line through hills and mountains, under the sky of your clock | Every tool call couples a wagon of its kind. When the turn ends the train pulls into a station named for the turn, and leaves the wagons there when the next one starts. A failed call's wagon limps along throwing sparks |
| `life` | Conway's Game of Life in a lit dish, dead cells glowing as they fade | Every tool call drops a pattern of its kind into the dish (gliders, spaceships, acorns), in its kind's color. A failed call is a blight |
| `pulse` | A heart monitor's trace and its readout, on the terminal or on the monitor's own screen | Every tool call is a beat, a failed one a beat out of step. At rest the heart beats slow and small. Where the band is wide enough, the readout shows the rate, the beats, the beats out of step and a bar for each recent turn |
| `fire` | A fire the band across, or with `/ambient backdrop on` a brick fireplace in a firelit room | It burns higher while Claude works, every call is a log on the fire, and a failed call turns the flames blue for a moment |
| `matrix` | Digital rain, near and far, on the terminal or on a screen of its own | Calls rain down in their kind's color, failed ones in red, and the end of a turn decodes on the screen |
| `lofi` | A rainy city window, a laptop, a mug, a lamp, a radio with an equalizer and a sleeping cat | The laptop types what Claude is doing, the equalizer bounces with the calls, and a failed call startles the cat |

A tool call's kind is one of read, search, edit, shell, web, agent, MCP or other, taken from the tool's name.

## Sound

`/ambient sound on` turns the sound on. It is off until you ask for it.

Every scene has a bed, a quiet loop that goes on while the scene shows, and three short sounds: a call, a failed call, and the end of a turn.

| Scene | Bed | A call | A failed call | The turn ends |
| --- | --- | --- | --- | --- |
| `aquarium` | Water and bubbles | A bubble | Two low bubbles | A sprinkle of food |
| `bonsai` | A breeze, far birds, a wind chime | A kalimba note | A leaf lets go | New growth |
| `city` | A far street, cars passing | A block set in place | The lights go | Fireworks, streets away |
| `stars` | A night drone, crickets | A glass chime | A star falls | An arpeggio |
| `weather` | Fair with birds, rain, storm or snow, as the sky is | A drop | Thunder | A harp run |
| `train` | Chuffing on the line, steam breathing at the station | A wagon coupled | A puff of steam | The whistle |
| `life` | A low hum, cells flickering as notes | A two-note pop | Two notes that disagree | Two notes |
| `pulse` | A slow heartbeat | The monitor's pip | A beat out of step | A closing pip |
| `fire` | A crackling hearth | A log and its sparks | The flame's whoosh | The fire settles |
| `matrix` | A low drone, falling blips | Three blips down | A short buzz | A chord decoded |
| `lofi` | Eight bars of lofi: keys, a soft kit, a worn record, rain on the window | A key pressed | The cat, woken | Two notes |

- **A call's kind is its note.** Each kind of tool call plays its own note of a pentatonic scale, so a turn of Claude's work is a small tune.
- **One session plays the bed, however many are open.** It is the session you last used: the one you last typed an `/ambient` command in or started a turn in. The others fall silent within two seconds, and one of them takes over when that session ends. The short sounds are each session's own.
- **Nothing is a recording.** Every sound is synthesized by `tools/sound/synth.js` and written to `sounds/` by `tools/sound/build.js`.

## The real sky

`/ambient weather <city>` makes the weather scene follow the real sky over a place: clear, cloud, rain, snow or thunder, day or night, with the place and the temperature in the corner. Failed calls still storm on top of it. `/ambient weather auto` takes the city your machine's time zone is named for, and `/ambient weather off` goes back to Claude's work alone.

Weather data by [Open-Meteo.com](https://open-meteo.com/), under CC BY 4.0. Their free API is for non-commercial use.

## Commands

| Command | What it does |
| --- | --- |
| `/ambient` | Opens the picker: a key per scene, plus the settings below |
| `/ambient <scene>` | Picks a scene by its name, the start of it, or an alias (`skyline`, `ekg`, `tree`, `fish`, `cat` and the like) |
| `/ambient list` | Names the scenes and shows the settings |
| `/ambient next`, `/ambient prev` | Steps through the scenes |
| `/ambient off`, `/ambient on` | Takes the band away, and brings it back. While it is off nothing is counted and nothing sounds. The row under the hint line stays, so `[ ○ band ]` there brings the band back with a click. Every open session follows within two seconds |
| `/ambient close` | Takes it all away, in every open session within two seconds: the band, its sound and the row under the hint line. `/ambient exit` and `/ambient quit` do the same. `/ambient on` brings them back as they were |
| `/ambient sound [on\|off]` | The scene's sound. Off to begin with. `/ambient mute` and `/ambient stop` turn it off, `/ambient play` turns it on |
| `/ambient volume <0-100\|up\|down>` | How loud. 55 to begin with |
| `/ambient hint [on\|off]` | The controls under the hint line: `♪ lofi  [ ● band ]  [ ◉ always ]  [ - ] 5 rows [ + ]  [ ● sound ]  [ - ] 55% [ + ]  [ scenes ]`. A click switches the band, switches it between showing always and only while Claude works, makes it a row shorter or taller, switches the sound, turns the volume down or up, or opens the picker and closes it again. Where the terminal is too narrow for the row, the controls go on to the next one. They need a pointer, so they show in the terminal's fullscreen layout and the desktop app; on the terminal's main screen the hint line ends in `♪ lofi 55%` instead |
| `/ambient hint <control> [on\|off]` | Shows one control in that row, or leaves it out, so the row holds only what you use: `name`, `band`, `when`, `rows`, `sound`, `volume` or `scenes`. With no word, the other of the two. The picker shows and hides them too, under "Under the prompt" |
| `/ambient weather <city\|auto\|off>` | The place whose real sky the weather scene follows |
| `/ambient shuffle [on\|off]` | A new scene with every turn |
| `/ambient rows <3-10>` | How tall the band is. Five rows to begin with. The `[ - ] 5 rows [ + ]` under the hint line sets it too |
| `/ambient when [always\|working]` | Whether the band shows always, or only while Claude works. With no word, the other of the two. The `[ ◉ always ]` switch under the hint line turns it too |
| `/ambient backdrop [on\|off]` | Whether the fireplace, the heart monitor and the digital rain paint a backdrop of their own, or show your terminal behind them. Off to begin with: the terminal shows. With no word, the other of the two. The picker switches it too |
| `/ambient replant` | Plants a new bonsai |

The band is Claude Code's own band above the prompt, so its keys work here too: `ctrl+x` `ctrl+a` collapses it.

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287. Mods sit behind a rollout switch, so if `/ambient` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app. The band is not drawn on other surfaces; the picker is.
- A band at least 20 columns wide and 3 rows tall.
- The scenes are painted in 24-bit color, most of them every cell of the band, and look best in a terminal that has it. The Matrix scene uses half-width katakana, which your terminal's font has to have.
- Sound needs macOS, where Claude Code has a player for it. Elsewhere the scenes are silent.

## What it does on your machine

The mod registers one slash command, draws one band above the prompt and one pane, the picker. It reads no files and runs no processes. It never changes a prompt, a tool call or a tool's result.

While the band is on, it reads two things of each tool call Claude makes: the tool's name, to sort it into a kind, and whether the call failed. It reads nothing of the call's arguments or output. It also notes when a turn starts and ends. The counts it keeps of these live in the session and are gone with it.

**Sound.** With the sound on, it plays files from its own `sounds/` folder through Claude Code's player. It plays nothing else and nothing while the sound is off.

**Network.** It makes no request until you name a place with `/ambient weather <city>`. From then on it asks Open-Meteo two things: once, where the place is (`geocoding-api.open-meteo.com`, sending the name you typed, or with `auto` the city of your time zone), and every quarter of an hour what the sky does there (`api.open-meteo.com`, sending the place's coordinates). `/ambient weather off` stops it.

It saves four things in the plugin's own Claude Code store:

- Your settings: the scene, on or off, the rows, when it shows, shuffle, the sound and its volume, and the place you named with its coordinates.
- The bonsai: its seed, the turns it has seen, the leaves it shed.
- Today's skyline: the date and the number of edits.
- Which session plays the bed: a random id made when the mod loads and the time it last said so, removed when the sound goes off or the session ends.

It reads the clock for the day the skyline belongs to and for the hour and month the scenes dress for.

Its hooks, all in `hooks/register.tsx`:

- `session.start` registers the `/ambient` command and loads the settings, the bonsai and today's skyline, then passes the event on unchanged. `session.end` stops the bed and gives its place up to another session.
- `command.run` answers only the `/ambient` command.
- `ui.render` draws only the band above the prompt and the mod's own pane. Where the band is off, a survey holds it or there is no room, it passes the event on. It also draws a row of its own controls under the hint line, or where there is no pointer adds the scene and its sound after the line, leaving the hint itself and what other mods put there as they are.
- `ui.message` reads only what the mod's own band posts: which bed the scene shows now.
- `ui.close` notes that the mod's own pane closed, and passes every close on.
- `tool.call` counts Claude's calls while the band is on, as described above, sounds them, and passes each call and its result on untouched.
- `turn.start` and `turn.complete` count the turns: the second grows the bonsai, keeps the bonsai and the skyline, sounds the turn's end, and with shuffle on picks the next scene. Both pass the event on unchanged and decide nothing.

The same as a privacy policy: [PRIVACY.md](PRIVACY.md).

The files under `tests/` run only under `claude plugin test`. They are never loaded in a session. The files under `tools/` and `docs/` are never loaded by the mod either: they make the sounds and the page.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-ambient
claude plugin validate claude-ambient
claude plugin test claude-ambient
claude --plugin-dir claude-ambient
```

Once the mod has loaded from the folder, the engine lays its types beside it and `tsc -p claude-ambient` type-checks it.

`hooks/register.tsx` holds the hooks, the command and the picker. `hooks/band.tsx` is the band: it keeps the clock, tells the scene what happened and draws what the scene painted. `hooks/kit.ts` is what a scene is made with: a canvas of pixels, two to a cell, with a layer of glyphs over it. `hooks/catalog.ts` names the scenes and the kinds of tool calls.

A scene is one file under `hooks/scenes/` exporting four functions: `start` makes its state, `step` moves it one tick (a tenth of a second), `hear` takes in a tool call, a failure, the end of a turn or Claude starting and stopping work, and `paint` draws it. A fifth, `bed`, is for a scene with more than one bed: it says which fits what the scene shows. To add a scene, write the file, add it to the table in `hooks/band.tsx` and to the list in `hooks/catalog.ts`, and give it sounds in `tools/sound/synth.js`.

### The sounds

```sh
bun tools/sound/build.js   # sounds/*.m4a and hooks/beds.ts, from tools/sound/synth.js
bun tools/site/build.js    # docs/scenes.js and docs/synth.js, for the page
```

`tools/sound/synth.js` draws every sound sample by sample; the page runs the same file in the browser. The build needs macOS (`afconvert`). It also checks its own work: each bed's file is laid over itself one loop on, as the mod plays it, and the loudness around the join is compared with a seamless loop.

A bed's file runs two seconds past its loop, and the mod starts the next play one loop after the last, so the two cross over. Claude Code's own loop leaves about a second of silence between plays, which is why the mod does not use it.

## License

MIT
