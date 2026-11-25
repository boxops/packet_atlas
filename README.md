# Packet Atlas

A near-future, game-quality 3D command centre for network operations. Sites float as holographic islands over an endless grid. Network tiers stack from WAN/core down to endpoints. Links are neon light tubes carrying live particle streams. Problems come to you.

- **Zero-friction start:** open the URL and land on a cinematic fly-in with current problems already highlighted.
- **One command palette** (`Ctrl/⌘+K`): hostnames, IPs, MACs, VLANs, sites and alarms, or questions like *"show me all down links in London"* and *"path from 10.1.1.10 to 10.2.2.20"*.
- **Smart camera:** click to focus, double-click to zoom in, `Esc` to step out, breadcrumbs from *Global › London › Rack A3 › lon-leaf-03*.
- **Incident mode** (`I`) flies through active alarms in priority order, explaining each one and suggesting a next step.
- **Radial quick actions** on right-click: inspect, trace path, neighbours, show commands, copy IP, SSH.
- **Wallboard mode** for NOC screens, a **guided tour**, a **legend**, **accessibility mode** (colour-blind palette, reduced motion, effects off) and **performance mode** for weaker GPUs.

## Quick start

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # unit tests (query parser, path trace, search, model, import)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

### URL options

| Parameter | Effect |
|---|---|
| `?topology=<url>` | Load your own topology JSON instead of the demo (see [docs/DATA_MODEL.md](docs/DATA_MODEL.md)). Try `?topology=sample-topology.json`. |
| `?empty=1` | Start in the empty state |
| `?wallboard=1` | Start in wallboard mode (automatic on viewports ≥ 2560×1300) |
| `?tour=1` | Force the guided tour |
| `?fx=ultra\|balanced\|performance` | Pin the effects level on this device |

## Documentation

- [UX spec](docs/UX_SPEC.md): user journeys, screen states, shortcut map, radial menu, performance budget.
- [Visual design spec](docs/VISUAL_DESIGN.md): spatial metaphor, health language, colour, light, motion, typography, accessibility.
- [Data model](docs/DATA_MODEL.md): topology schema and how to stream live updates.

## Project layout

```
src/
  main.ts            entry: data source selection, boot
  styles.css         design tokens and every UI surface
  core/              pure logic: NL query parser, path trace, fuzzy search, prefs, palette, audio
  data/              domain types, Model (indexed + derived health), demo generator, telemetry sim, importer
  scene/             three.js world: islands, devices, links/particles, camera rig, grid, post-processing
  ui/                app controller, HUD, anchored panels, palette, radial menu, incident, wallboard, overlays
tests/               vitest unit tests
docs/                UX spec, visual design spec, data model
```

## Tech

TypeScript, [three.js](https://threejs.org) (UnrealBloom, Bokeh DOF, CSS2D labels), Vite, Vitest. No UI framework. Fonts (Inter, JetBrains Mono) are self-hosted via `@fontsource`. All textures and sounds are generated procedurally, so there are no assets to download.

## License

Apache-2.0
