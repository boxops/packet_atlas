## Visual design: futuristic, premium, game-quality
The world should feel like a near-future command centre: think sci-fi film UI, Tron and high-end space-sim HUDs. It must stay clean and readable, never gimmicky.

Spatial metaphor (propose improvements if you have better ideas):
- Sites/regions are floating islands or city districts on a dark holographic grid. Zooming in moves seamlessly from the global view down to a site, then a rack, then a device, with no loading screens.
- Network tiers are vertical layers: WAN/core at the top, then distribution/spine, then access/leaf, with endpoints at ground level.
- Devices are sleek, stylised 3D objects whose shape shows the role (router, switch, firewall, AP, server). They have subtle idle animations such as slow rotation, breathing glow and scanning lines.
- Links are neon light tubes. Thickness shows capacity, particle streams show live throughput (speed and density scale with traffic), and colour shows utilisation.
- Health is shown visually: a soft green/cyan glow when healthy, amber pulse for warnings, and red alarms with a shockwave ripple. Flapping interfaces glitch or flicker. Unreachable devices become translucent wireframe "ghosts".

Look and feel:
- Dark theme with a deep navy/black background, a cyan/teal primary accent, magenta for secondary highlights, and amber/red reserved strictly for alerts.
- Post-processing: bloom on emissive elements, subtle depth of field when focusing on a device, light fog for depth, and a faint scanline/grain overlay that can be toggled off.
- UI panels are glassmorphism holograms: translucent, blurred backgrounds, thin glowing borders, and smooth slide/fade transitions. Panels open anchored in 3D space next to the device they describe.
- Typography: a modern geometric/monospace pairing (e.g. Inter + JetBrains Mono). Data is always crisp and legible at any zoom.
- Motion design: every transition (camera moves, panel opens, state changes) is eased and lasts 200–600 ms. Nothing snaps or jumps.
- Optional ambient sound design (soft hum, UI clicks, alarm tone), muted by default.
- Include a legend, an accessibility mode (colour-blind-safe palette, reduced motion, effects off) and a "performance mode" for weaker GPUs.

## Seamless user experience
The tool must feel effortless. An engineer should get value within 10 seconds of opening it, without training.
- Zero-friction start: open the URL and land on a cinematic fly-in to the global overview, with the current problems already highlighted.
- One universal command palette (Ctrl/Cmd+K): type a hostname, IP, MAC, VLAN, site or alarm and the camera flies straight to it. Also accept natural-language queries such as "show me all down links in London" or "path from 10.1.1.10 to 10.2.2.20".
- Smart camera: click anything to focus it smoothly, double-click to zoom in, Esc to step back out one level. Breadcrumbs (Global > London > Rack A3 > leaf-01) let me jump between levels.
- Context-aware panels show the most important information first (status, alarms, top interfaces), with progressive disclosure for detail. No clutter.
- Right-click radial menu on any object for quick actions: inspect, trace path from here, show neighbours, run show command, copy IP, open SSH session.
- Problems come to me: an "incident mode" button jumps the camera through active alarms in priority order with a short explanation of each.
- Hover tooltips everywhere. Keyboard shortcuts for everything, with a "?" overlay listing them. Consistent controls throughout.
- First-run guided tour (skippable, under 60 seconds) and an empty-state/demo mode using mock data.
- Responsive: works on a large NOC wall screen (auto "wallboard" mode that cycles views) as well as a laptop. Touch support on tablets is a bonus.
- Fast: initial load under 3 seconds, interactions under 100 ms, no blocking spinners. Stream data in progressively.
- Remember user preferences: last view, bookmarks, theme, effects level.

Deliver a short UX spec covering: the key user journeys (morning health check, incident investigation, path trace, device inspection), screen states and the shortcut map, alongside the visual design spec.