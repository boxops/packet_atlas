# Packet Atlas: data model & connecting a real source

Out of the box Packet Atlas runs on a seeded demo network with simulated telemetry. To show your own network, give it a topology JSON:

```
https://<host>/?topology=/path/to/topology.json
```

If the file can't be loaded, or contains no devices, the app shows the empty state with the reason and a *Load demo network* button.

A runnable example is in [`public/sample-topology.json`](../public/sample-topology.json): open `?topology=sample-topology.json`.

## Minimal schema

Only the fields marked **required** are needed. Positions, interface lists and telemetry defaults are derived for you by `src/data/normalize.ts`:

- **Sites** without `x`/`z` are laid out on a grid.
- **Devices** are placed at their tier's height. Devices with a `rackId` stand in that rack, with endpoints stacked inside it. Others are spread on a ring.
- **Link kind** is inferred: `wan` if the ends are in different sites, `access` if either end is an endpoint, else `fabric`.

```jsonc
{
  "sites": [
    {
      "id": "dub",              // required
      "name": "Dublin",         // required
      "code": "dub",            // short code shown on the island (default: first 3 letters)
      "region": "EMEA",
      "aliases": ["ie"],        // extra names for search / natural-language queries
      "x": 0, "z": 0,           // optional world position of the island
      "racks": [{ "id": "dub-r1", "name": "Rack 1" }]
    }
  ],
  "devices": [
    {
      "id": "dub-leaf-01",      // required
      "hostname": "dub-leaf-01",// required
      "role": "switch",         // required: router | firewall | switch | ap | server
      "siteId": "dub",          // required
      "ip": "10.10.1.1",        // required (management IP; used by search, copy, SSH)
      "tier": "access",         // core | distribution | access | endpoint (default from role)
      "rackId": "dub-r1",
      "model": "…", "os": "…", "serial": "…", "mac": "02:…", "vlans": [10, 100],
      "cpu": 0.42, "mem": 0.3,  // 0..1
      "reachable": true,         // false → wireframe ghost
      "flapping": false          // true → glitch effect
    }
  ],
  "links": [
    {
      "id": "l1",                                           // required
      "a": { "deviceId": "dub-rtr-01", "iface": "xe-0/0/1" }, // required
      "b": { "deviceId": "dub-fw-01", "iface": "ethernet1/1" },// required
      "capacityGbps": 40,                                   // required (drives tube thickness)
      "util": 0.35,                                         // 0..1 (drives colour + particles)
      "status": "up",                                       // up | down
      "flapping": false, "flaps": 0, "errors": 0
    }
  ],
  "alarms": [
    {
      "id": "a1",
      "severity": "critical",        // critical | major | warning
      "targetType": "device",        // device | link
      "targetId": "dub-srv-02",
      "siteId": "dub",
      "title": "Device unreachable: dub-srv-02",
      "explanation": "Plain-language summary shown in incident mode.",
      "action": "Suggested next step.",
      "raisedAt": 1764000000000      // epoch ms
    }
  ]
}
```

Links that reference unknown devices are dropped.

## Live updates

All scene and UI code reads the network through `Model` (`src/data/model.ts`). A live adapter only needs to:

1. Mutate the telemetry fields in place (`link.util`, `link.status`, `link.flapping`, `device.cpu`, `device.reachable`, …), then call `model.emit('telemetry', { now: Date.now() })`. Colours, particles and open panels update without re-rendering.
2. Call `model.raise({...})` / `model.clear(alarmId)` for alarms. Beacons, rims, status chips, the ticker, incident mode and the alarm tone all follow.

`src/data/telemetry.ts` (the demo simulator) is a complete example of such an adapter. A WebSocket or SSE client that applies deltas in the same way is all a production deployment needs.

## Device console backend

By default the console prints simulated output. To run real commands, pass a backend URL:

```
https://<host>/?cli=https://your-backend.example/run
```

For each command the app sends a `POST` with a JSON body, and prints the response body as plain text (non-2xx responses are shown as errors):

```json
{ "deviceId": "lon-leaf-03", "hostname": "lon-leaf-03", "ip": "172.16.1.33", "command": "show interfaces brief" }
```

Only commands in the device's command list can be sent; typed input is first resolved against that list, including abbreviations. Your backend should still enforce its own allowlist and authentication: never execute arbitrary input on network devices. If the backend is on another origin, it must allow CORS from the Packet Atlas origin.
