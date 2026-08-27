# dsh-lab-controller

DSH Desktop/Web plugin: a read-only SONiC lab controller registered through
dsh-better-sidebar's `registerTab` extension point.

## Features

- **Physical topology**: four Centec SONiC switches rendered as 32-port rack
  front panels, live Oper/Admin LEDs and LLDP Bezier cables
- **Logical experiment topology**: YAML intent from `experiment.yml`, with
  SWxEthy endpoints, Ag/speed/IP labels and live configuration comparison
- Mock-first client load: rack panels appear immediately, then one complete
  port/LLDP snapshot replaces the placeholder state atomically
- Two-hop collection with ssh2: jumphost -> direct-tcpip -> switch
- A/B group lock status from `sws` and read-only `swl` log viewer
- Floating switch detail panel; no permanent canvas width is reserved

## Read-only API

- `GET /api/lab/topology?fresh=1`
- `GET /api/lab/experiment`
- `GET /api/lab/locks`
- `GET /api/lab/locklog`

All routes carry a loopback + same-origin trust fence. The collector only runs
fixed read-only probes. There is no generic command, config-write, `swr`,
reboot or image-push endpoint.

## Experiment YAML v1

`experiment.yml` is the source of experimental intent. The live topology is
the source of operational truth. The UI compares them and maps every link to:

- green: YAML endpoints match LLDP and both ports are Oper UP
- amber dashed: YAML endpoints match LLDP but one or both ports are down
- red dashed: endpoint/interface missing or LLDP does not match YAML
- gray dashed: the first live collection is still running

Minimal link example:

```yaml
apiVersion: soniclab/v1
kind: Experiment
metadata:
  name: ag100-reference
  title: Ag100 / Ag200 实验拓扑
render:
  defaultView: logical
nodes:
  - id: sw1
    type: switch
    device: sw1
    label: SW1 164
    position: { x: 120, y: 70 }
  - id: sw3
    type: switch
    device: sw3
    label: SW3 166
    position: { x: 120, y: 520 }
links:
  - id: ag100-sw1-sw3
    from: { node: sw1, interface: Ethernet28, address: 10.10.10.254 }
    to: { node: sw3, interface: Ethernet6, address: 10.10.10.1 }
    bundle: Ag100
    speed: 200G
```

Interface display uses SONiC's zero-based convention: `Ethernet0` becomes
`SW1Eth0`; physical front-panel silk-screen 1 still maps to Ethernet0.

A custom absolute file can be supplied through plugin config
`experimentFile`. The packaged default is `experiment.yml` next to `lib/`.

## lab.json

`lab.json` contains jumphost/switch credentials, four-switch inventory and
optional static physical cables. Static links confirmed by LLDP become
`both`; unconfirmed links remain dashed.

## Development

```sh
pnpm install --ignore-scripts
pnpm typecheck
pnpm build
```

The current DSH Desktop profile is `desktop`. Local development uses a
junction:

```text
~/.dsh/profiles/desktop/node_modules/dsh-lab-controller
  -> C:/sonicPlan/plugins/dsh-lab-controller
```

Client and host bundles are rebuilt into `lib/`. A full DSH Desktop restart
is required when the host route/plugin tree changes.
