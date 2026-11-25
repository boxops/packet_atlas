# Packet Atlas: UX spec

**Goal:** an engineer gets value within 10 seconds of opening the URL, with no training.
**Principle:** problems come to the user; everything else is one keystroke or one click away.

---

## 1. Zero-friction start

| t | What happens |
|---|---|
| 0 ms | Page shell, grid and HUD render. No spinner. |
| ~0.5 s | Topology is in memory; site islands stream in one by one (≈110 ms apart, each eased over 500 ms). |
| 0–2.2 s | Cinematic fly-in from high orbit down to the global overview. Any input interrupts it. |
| ~2.2 s | Problems are already visible: red/amber island rims, alarm light beams, status chips (`✖ 2 critical  ▲ 4 warning  ◌ 1 unreachable  ⇣ 1 link down`). |
| first visit | Guided tour starts (6 steps, auto-advances every 9 s, under 60 s total, **Skip** always visible). |
| return visit | A toast offers **Resume where you left off: London › Rack A3**. Preferences, bookmarks and effects level are restored silently. |

Measured on the production build: interactive at ≈450 ms (target: < 3 s).

---

## 2. Navigation model

Four semantic levels, one continuous camera with no loading screens:

```
Global  ›  Site (London)  ›  Rack (Rack A3)  ›  Device (lon-leaf-03)
                           ↘  Link (lon-spine-02 ↔ lon-leaf-03)
```

| Input | Result |
|---|---|
| Click | Select and gently re-centre. The inspector panel opens anchored next to the object. |
| Double-click / `Enter` | Zoom one level into the object. |
| `Esc` | Close the most transient thing first (radial menu → palette → overlays → console → path-pick → incident mode → query highlight → selection), then step out one level. |
| Breadcrumbs | Jump to any ancestor level. |
| `H` / brand logo | Global overview. |
| `1`–`9` | Jump straight to site N. |
| `[` `]` | Previous / next device at the current level. |
| Drag / right-drag / scroll | Orbit / pan / zoom (zoom-to-cursor). Touch: one-finger orbit, two-finger pan/pinch, tap, double-tap, long-press. |

All camera moves ease (cubic in-out) over 600 ms (200 ms with reduced motion). The only longer motion is the opening fly-in.

---

## 3. Key user journeys

### 3.1 Morning health check (target: < 30 s)
1. Open the URL. The fly-in lands on the global overview with problems highlighted.
2. Read the status chips; red/amber islands and light beams show *where*.
3. Press `I` (or click any chip). **Incident mode** flies to the highest-priority alarm and shows a card with severity, site, age, a plain-language explanation and the suggested next step.
4. `→` through each alarm; `Space` to auto-play. `Esc` to finish.
5. Optional: `B` bookmarks a view to revisit after the stand-up.

### 3.2 Incident investigation
1. A new alarm appears: the live ticker updates, the device glitches as its state changes, the beam rises, and an optional alarm tone plays.
2. Click the status chip → incident mode jumps to it, or `Ctrl/⌘+K` → type the hostname or alarm text.
3. The inspector shows **alarms first** (what, why, next step), then CPU/memory/uptime/throughput, then the top three interfaces with down/flapping ones pinned to the top.
4. Right-click → **Show neighbours** (`N`) dims everything except the blast radius.
5. Right-click → **Run show command** (`C`) opens a glass terminal on the device. The command line takes typed commands with network-OS abbreviations (`sh int br`), `Tab` completion, `↑`/`↓` history and built-ins (`help` or `?`, `clear`, `history`, `exit`). Quick-command tabs list the role-appropriate commands. Output is simulated unless a command backend is configured (`?cli=<url>`, see `docs/DATA_MODEL.md`).
6. **Open SSH session** hands off to the OS `ssh://` handler and offers a *Copy command* fallback.

### 3.3 Path trace
1. `Ctrl/⌘+K` → `path from 10.1.1.10 to 10.2.2.20` (also `trace A to B`, `A -> B`, hostnames or MACs). The palette previews the answer (`9 hops · ~25.8 ms`) before you press Enter.
   *Or:* right-click a device → **Trace path from here** (`T`), then click the destination or type it.
2. The camera frames the whole path; path links turn magenta and their particles race in the direction of travel. Everything else dims.
3. The docked path panel lists every hop with in/out interfaces, per-link utilisation, estimated latency, bottleneck capacity and hottest hop. **Reverse** and **Clear path** are one click.
4. Down links and unreachable devices are skipped automatically. If no live path exists, the user is told why.

### 3.4 Device inspection
1. Find it: palette (hostname, IP, MAC, serial, VLAN), breadcrumbs, or double-click through Site → Rack → Device.
2. Device level: depth of field softens the background (Ultra effects); labels show the device, its rack-mates and its neighbours.
3. Progressive disclosure in the panel: header (role, health, IP with copy) → alarms → key stats with CPU sparkline → top interfaces → expandable **All interfaces**, **Neighbours**, **Device facts** (model, OS, serial, MAC, VLANs). Expanded sections stay open while live data updates in place.
4. Every interface/neighbour row is a link: click to fly there.

---

## 4. Command palette (`Ctrl/⌘+K` or `/`)

One box for everything, ranked in this order:

1. **Answer**: natural-language queries are parsed and previewed live: `show me all down links in London` → *1 down link in London*; `firewalls in Frankfurt`; `links over 80%`; `critical alarms`; `unreachable servers`; `vlan 300 in Tokyo`; `wan links in São Paulo` (accents optional).
2. **Top result**: exact or fuzzy match on hostname, IP, MAC, serial, site (name, code, alias such as `nyc`), rack, VLAN or alarm text. Subsequence matching means `lonleaf3` finds `lon-leaf-03`.
3. Grouped results (Sites, Racks, Devices, Links, Alarms, VLANs), then matching **Commands** and **Bookmarks**.

Empty palette = active alarms, recent items, bookmarks and example questions.
Filter results highlight on the map (everything else dims) and appear as a chip under the top bar with a clickable result list; `Esc` clears.

---

## 5. Screen states

| State | Trigger | What the user sees |
|---|---|---|
| **Loading / streaming** | First 0.5–1 s | Grid + HUD immediately; islands ease in one by one. Never a blocking spinner. |
| **Fly-in** | Every load | 2.2 s descent to global view (instant with reduced motion); interruptible. |
| **First-run tour** | First visit or `?tour=1` | Spotlight + card, 6 steps, < 60 s, skippable; replay from Settings. |
| **Global overview** | Default | Site islands with labels and health chips, WAN arcs, alarm beams. |
| **Site / Rack / Device / Link** | Double-click, palette, breadcrumbs | Level-appropriate labels; anchored inspector panel. |
| **Query highlight** | Palette answer, *Neighbours* | Matches lit, rest dimmed to ~10%; result chip + list. |
| **Path trace** | Path query, *Trace path* | Magenta path, docked path panel. |
| **Path pick** | *Trace path from here* | Banner "click a destination"; crosshair cursor over devices. |
| **Incident mode** | `I`, status chips | Bottom card with progress bar, explanation, next step; prev/next/auto-play. |
| **Wallboard** | `W`, `?wallboard=1`, or viewport ≥ 2560×1300 | Larger type, minimal chrome, big clock; cycles global (20 s) → incidents (9 s each) → each site (8 s). Any interaction pauses it for 45 s. |
| **Empty** | `?empty=1`, or a failed `?topology=` load | Explains why, points to `docs/DATA_MODEL.md`, **Load demo network** button. |
| **Demo** | No data source configured | Seeded six-site network with live simulated telemetry; `DEMO DATA` badge. |
| **All clear** | No alarms | Status shows `● All systems nominal`; incident mode says so. |
| **Low frame rate** | < 28 fps sustained | Effects step down Ultra → Balanced → Performance with a toast offering *Keep Ultra*. |
| **Narrow screen** | < 760 px | Top bar wraps, inspector becomes a bottom sheet, larger touch targets. |

---

## 6. Shortcut map

The same map is shown in-app by pressing `?` (source: `src/ui/shortcuts.ts`).

| Find & navigate | |
|---|---|
| `Ctrl/⌘+K`, `/` | Command palette: search or ask |
| Click | Select & focus |
| Double-click, `Enter` | Zoom into selection |
| `Esc` | Close / clear / step out one level |
| `H` | Global overview |
| `1`–`9` | Jump to site |
| `[` `]` | Previous / next device at this level |
| `F` | Frame selection |
| `B` | Bookmark current view |

| Act on selection | |
|---|---|
| Right-click, long-press | Radial quick actions |
| `T` | Trace path from selection |
| `N` | Show neighbours |
| `C` | Run show command |
| `Y` | Copy IP address |

| Console (when the command line is focused) | |
|---|---|
| `Enter` | Run command (abbreviations like `sh int br` work) |
| `Tab` | Complete; lists options when ambiguous |
| `↑` `↓` | Command history |
| `?` (empty line) | List available commands |
| `Ctrl+L` | Clear transcript |
| `Esc` | Close console |

| Incidents | |
|---|---|
| `I` | Incident mode |
| `←` `→` | Previous / next alarm |
| `Space` | Auto-play |

| View & settings | |
|---|---|
| `L` | Legend |
| `W` | Wallboard mode |
| `S` | Settings |
| `E` | Cycle effects level |
| `A` | Accessibility mode |
| `G` | Scanline / grain overlay |
| `M` | Sound on / off |
| `?` | Shortcut overlay |

Every toolbar button shows a tooltip with its shortcut; every 3D object shows a hover tooltip (name, health, key metric).

---

## 7. Radial menu (right-click / long-press)

| Object | Actions |
|---|---|
| Device | Inspect · Trace path from here · Show neighbours · Run show command · Copy IP · Open SSH session |
| Site | Enter site · Show alarms · WAN links · Firewalls · Copy site code |
| Rack | Enter rack · Inspect leaf switch · Leaf neighbours · Copy rack name |
| Link | Inspect · Trace across link · Go to A · Go to B · Copy interfaces |

Keyboard: arrow keys / Tab move between items, Enter activates, Esc closes.

---

## 8. Preferences (persisted in `localStorage`)

Last view and camera, bookmarks (up to 20), accent theme (cyan / emerald / violet), effects level (and whether the user chose it), colour-blind palette, reduced motion, effects off, scanlines, sound (muted by default), legend open, tour completed. *Reset preferences* is in Settings.

## 9. Performance budget

| Budget | Target | How |
|---|---|---|
| Initial load | < 3 s | ~200 kB gzipped JS (three.js in its own cacheable chunk), procedural textures, self-hosted fonts with `font-display: swap`. |
| Interaction | < 100 ms | Picking throttled to one raycast per frame; panels update values in place; no layout thrash (panels move via `transform`). |
| Frame rate | 60 fps | All link particles in one draw call; shared geometries; automatic effects downgrade. |
| Data | Streamed | Sites reveal progressively; telemetry updates every second without re-rendering panels. |
