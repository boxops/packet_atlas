# Packet Atlas: visual design spec

**Mood:** a near-future command centre, in the spirit of sci-fi film UI and high-end space-sim HUDs, but always clean and legible. If an effect does not carry information or depth, it is subtle or optional.

---

## 1. Spatial metaphor

| Concept | Representation |
|---|---|
| Site / region | Floating hexagonal **island** of dark glass over an endless holographic grid. A faint light cone underneath "suspends" it; its rim glows in the site's worst health colour. |
| Network tier | Vertical layers within each island, marked by dashed hex rings and labels: **CORE · WAN** (y=34) → **DISTRIBUTION · SPINE** (y=22) → **ACCESS · LEAF** (y=11) → endpoints at ground level (y=0). |
| Rack | Wireframe frame on the island deck; servers stack inside, with the leaf (ToR) switch floating above at the access tier. Server uplinks run as parallel cable lanes down the back of the rack. |
| Device | Stylised object whose **silhouette encodes role**. |
| WAN | Neon arcs between core routers of different sites, lifted high above the map. |
| Zoom | One continuous camera: Global → Site → Rack → Device, with no loading screens. |

### Device silhouettes

| Role | Shape | Idle animation |
|---|---|---|
| Router | Puck with an orbiting ring | Ring slowly rotates |
| Firewall | Hexagonal pillar with two shield bands | Breathing glow |
| Switch | Flat slab with a glowing port strip on the front | Breathing glow |
| Access point | Dome | Two broadcast rings expand and fade |
| Server | Rack-unit slab | A scan line sweeps the front panel |

Core devices are 1.35× scale and spines 1.2×. All bodies share one dark metallic material (`#0b1628`, metalness 0.75) with emissive edge lines, so the status colour always comes from light, not paint.

### Proposed improvements over the brief (implemented)
- **Alarm light beams.** A vertical beam rises from every alarmed device or link, so problems are visible from the global view before you can read a label. Beams fade out as the camera approaches, so they never block close inspection.
- **Problems roll up.** Island rims, site labels and the status bar all show the worst state below them. You can read the whole network's health without zooming.
- **Link problems degrade both ends.** A device whose uplink is down shows amber, because it has lost redundancy, even though the device itself answers.
- **Magenta means "you did this".** It is reserved for selection, the selection reticle, query results and traced paths, and never for state.
- **Utilisation never looks like an alarm.** Its colour ramp runs cool blue → cyan → white-hot. Amber appears only when an alert applies (≥ 90% congestion or flapping).

---

## 2. Health language

State is always encoded twice (colour + motion or shape), and a glyph accompanies colour everywhere in the UI.

| State | Glyph | 3D treatment | UI colour |
|---|---|---|---|
| Healthy | `●` | Soft green-cyan edge glow, slow breathing halo | `--ok #2ef2c9` |
| Warning / major | `▲` | Amber edges, halo pulses at 1 Hz, amber beam | `--warn #ffb020` |
| Critical | `✖` | Red edges, fast pulse, **shockwave ripple** every 2.2 s, red beam | `--crit #ff3b4e` |
| Unreachable | `◌` | Translucent **wireframe ghost** with a faint shimmer; no halo | `--ghost #7f9bb3` |
| Flapping | (warning) | Device jitters and its edges flicker; link opacity glitches and its particle flow stutters | `--warn` |
| State change | | 400 ms glitch burst at the moment of transition | |

## 3. Links

| Channel | Meaning |
|---|---|
| Tube thickness | Capacity, log-scaled (1G → 400G). WAN tubes are drawn 4× thicker so they read from orbit. |
| Particle density | Utilisation (12% → 100% of the link's particle budget). |
| Particle speed | Throughput (5 → 35 units/s; WAN 3×). Particles fade in and out at the ends so streams never pop. |
| Tube colour | Utilisation ramp `#1f5bff → #00e5ff → #eafcff`; amber if congested ≥ 90% or flapping; blinking red with no particles if down. |
| Magenta | Part of a traced path. Particles flow in the direction of travel at 1.8× speed. |

---

## 4. Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#03060d` | Deep navy-black background (radial gradient to `#08142a`) |
| `--accent` | `#00e5ff` | Primary: grid, rims, focus rings, primary buttons |
| `--magenta` | `#ff3df2` | Secondary highlight: selection, results, path |
| `--warn` / `--crit` | `#ffb020` / `#ff3b4e` | **Alerts only** |
| `--text` / `--text-2` / `--muted` | `#d9f4ff` / `#a9c6d9` / `#6f8ba3` | Text hierarchy |

Accent themes: **cyan** (default), **emerald** `#2bffb4`, **violet** `#9d8cff`.
**Colour-blind-safe palette** (Okabe–Ito): ok `#56b4e9`, warning `#f0e442`, critical `#d55e00`, unreachable `#a0a0a0`, highlight `#cc79a7`, utilisation `#0072b2 → #56b4e9 → #fff`.
One module (`src/core/palette.ts`) feeds both WebGL and CSS custom properties, so the 3D scene and the UI can never disagree.

## 5. Light & post-processing

| Effect | Setting | Notes |
|---|---|---|
| Bloom | UnrealBloom strength 0.85, radius 0.55, threshold 0.82 | Only emissive "neon" colours (pushed above 1.0 in linear space) cross the threshold, so text and bodies stay crisp. |
| Depth of field | Bokeh, eased in over ~150 ms | Device level only, Ultra only. |
| Fog | Exponential, density 0.00055 | Light depth cue at the global view. |
| Environment | Procedural room environment at 0.35 | Subtle specular on device bodies. |
| Tone mapping | Neutral, exposure 1.05 | Keeps cyan/magenta saturated. |
| Grid | Shader grid, 10/50-unit lines, distance fade, slow radar sweep | Brightened automatically when bloom is off. |
| Overlay | CSS scanlines + animated SVG grain at 55% overlay | Toggle with `G`. Hidden when effects are off. |
| Vignette | Radial, always on | Draws focus to the centre. |

### Effects levels

| Level | Bloom | DOF | Pixel ratio | Particles | Ambient dust |
|---|---|---|---|---|---|
| **Ultra** (default) | full-res | ✓ | ≤ 2 | 100% | ✓ |
| **Balanced** | half-res | – | ≤ 1.5 | 100% | ✓ |
| **Performance** | – | – | 1 | 50% | – |

Machines with ≤ 4 CPU cores start on Balanced. A sustained frame rate under 28 fps steps the level down automatically until the user picks one.

## 6. UI surfaces: glass holograms

- **Glass:** translucent navy gradient (`rgba(14,30,54,.8) → rgba(5,12,26,.74)`), `backdrop-filter: blur(16px) saturate(140%)`, 1px accent border at 22%, an outer accent glow, and a thin glowing top edge. Performance and effects-off modes use a solid fill instead of blur.
- **Anchored panels:** the inspector floats beside its object in 3D space and keeps clear of the object's on-screen footprint, with a dashed connector line to an anchor dot. It eases after the object as the camera moves, docks right when the object leaves the screen, and becomes a bottom sheet under 760 px.
- **Labels:** CSS-rendered (never textures), so text is pixel-crisp at any zoom. Level of detail: site labels at the global view; tier, rack and network-device labels inside a site; rack-mates and neighbours at the device level; inside a site, alarmed devices are always labelled. Query and path results label their matches.
- **Radius:** 10 px for panels, 7 px for buttons, pills fully rounded.

## 7. Typography

| Role | Face | Size / weight |
|---|---|---|
| UI text | Inter Variable | 12.5–14 px / 400–650 |
| Titles | Inter Variable | 16–22 px / 650 |
| Data, hostnames, IPs, labels | JetBrains Mono (slashed zero) | 11–16 px / 400–600 |
| Section eyebrows | JetBrains Mono, 0.16em tracking, uppercase | 10 px / 600 |

Both faces are self-hosted (`@fontsource`) with `font-display: swap`. Wallboard mode scales the whole UI by 1.35×.

## 8. Motion

- Every transition eases (`cubic-bezier(.22,.8,.24,1)` for UI, cubic in-out for the camera) within **200–600 ms**: camera 600 ms, panels 320 ms, hovers 200 ms. Nothing snaps.
- Exception: the opening fly-in (2.2 s, interruptible) and ambient idle loops.
- **Reduced motion:** idle animation stops, shockwaves become a static ring, glitches are replaced by steady colour + glyph, particles slow to 35%, camera moves take 200 ms, and UI panels fade without sliding or scaling.

## 9. Sound (optional, muted by default)

Synthesised with WebAudio, so there are no files to download: a low detuned hum (55 Hz, low-passed), a 40 ms click on selection, a soft whoosh on camera moves, and a two-tone chime on new alarms (higher pitch for critical). Toggle with `M`.

## 10. Accessibility

- **Accessibility mode** (`A`) = colour-blind palette + reduced motion + effects off, each also available on its own.
- Respects `prefers-reduced-motion` on first load and `prefers-contrast: more`.
- State never relies on colour alone (glyphs `● ▲ ✖ ◌`, motion, shape).
- Full keyboard operation, visible focus rings, ARIA roles on dialogs, menus and live regions (ticker, incident card, toasts).
