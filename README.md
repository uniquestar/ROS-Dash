# ROS-Dash
### A MikroTik RouterOS v7 Live Dashboard

> Real-time MikroTik RouterOS v7 dashboard — streaming binary API, Socket.IO, Docker-ready.

ROS-Dash connects directly to the RouterOS API over a persistent binary TCP connection, streaming live data to the browser via Socket.IO. No page refreshes. No agents. Built-in authentication, granular per-user permissions, and Cisco switch integration with a graphical port visualiser.

Collector lifecycle logic is standardized through a shared base implementation in [src/collectors/BaseCollector.js](src/collectors/BaseCollector.js), now used across all collector modules to reduce duplicate timer/reconnect/error code.
Runtime and API error handling are normalized through [src/util/errors.js](src/util/errors.js) so collector logs and HTTP error responses stay consistent.

Forked and significantly enhanced from [MikroDash](https://github.com/SecOps-7/MikroDash) by SecOps-7.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

### Dashboard
- **Live traffic chart** — per-interface RX/TX Mbps with configurable history window
- **System card** — CPU, RAM, Storage gauges with colour-coded thresholds, board info, temperature, uptime, and RouterOS update indicator
- **Network card** — animated SVG topology diagram with live wired client counts, multiple WAN IPs, LAN subnets, VPN peer count, and latency chart
- **Connections card** — total connection count, protocol breakdown, top sources with hostname resolution, top destinations with geo-IP country flags
- **IP Neighbours card** — CDP/LLDP discovered adjacent devices with interface, identity, IP, and version
- **WireGuard card** — active peer list with accurate connection status (peers with no handshake in 5 minutes shown as idle)

### Pages
| Page | Description |
|---|---|
| Interfaces | All interfaces as compact tiles with status, IP(s), live rates, and cumulative RX/TX totals |
| DHCP | Active DHCP leases with hostname, IP, MAC, status, lease type, and switch port location. Users with dhcp:write permission can Reserve (make static) or Release (remove static) leases directly from the table |
| VPN | All WireGuard peers (active + idle) as tiles sorted active-first, with allowed IPs, endpoint, handshake, and traffic counters |
| Connections | World map with animated arcs to destination countries, per-country protocol breakdown, top ports panel, and click-through connection detail modal |
| Switches | Graphical port visualiser and port allocation table — populated via SNMP from Cisco Catalyst switches, with optional per-switch write controls |
| Inventory | Canonical client inventory aggregated from DHCP leases, ARP, and switch MAC tables, with search and online/offline filtering |
| Routes | Active routing table with flags, destination, gateway, distance, and type |
| Address Lists | Firewall address lists grouped by list name with address, comment, and creation date |
| Audit Log | Paginated write-action history with timestamp, user, action, target, detail, and outcome filters |
| Firewall | Top hits, Filter, NAT, and Mangle rule tables with packet counts |
| Logs | Live router log stream with severity filter and text search |
| Users | User management — add, delete, change passwords, and configure per-page permissions |

### Authentication & Access Control
- **Login page** with username/password authentication
- **Session tokens** — HMAC-signed, 8-hour expiry, all sessions invalidated on server restart
- **SQLite-backed user store** — replaces flat `users.json`, supports concurrent access
- **Granular per-page permissions** — each user has independent read/write access per page
- **Inventory page access** — `inventory:read` grants visibility of the Client Inventory page
- **Audit Log page access** — `auditlog:read` grants visibility of the Audit Log page
- **Switch Admin tier** — users with `switchadmin:write` can manage per-switch write grants from the Switches page
- **Per-switch write grants** — users can be allowed to manage only specific switches while retaining read-only access to the rest
- **Admin users** — full access to all pages including Users management
- **Viewer users** — dashboard and about access by default; additional pages granted by admin
- **Protected WebSocket** — unauthenticated socket connections rejected server-side
- **CLI user management** — `src/add-user.js` for emergency access without the web UI

### Cisco Switch Integration
ROS-Dash polls Cisco Catalyst switches via SNMPv2c to build a complete port map, cross-referenced with DHCP leases and ARP tables for hostname and IP resolution.

- Polls MAC address tables per VLAN via VLAN-context SNMP (`community@vlan`)
- VLANs discovered dynamically from Mikrotik VLAN interface config — no hardcoding required
- Supports per-port access VLAN remap, shut/no-shut, and write-memory from the Switch Visualiser when `writeCommunity` is configured
- Write actions are enforced per switch: a user must either have `switchadmin:write` or an explicit grant for that switch
- Collects port admin state, link state, PoE delivery status, live PoE power, and connected device descriptions
- Supports single switches and multi-switch stacks — stack members displayed as separate switch panels
- Uplink ports included in visualiser (shown in purple), excluded from MAC table reporting
- Results surfaced on the Switches page and inline on the DHCP page (Switch + Port columns)
- Configured via `switches.json` (see Switch Setup below)

#### Port Visualiser
The Switches page includes a graphical port layout mirroring the physical switch faceplate:

- Ports laid out in pairs, odd ports top row / even ports bottom row (left to right)
- Colour coded: **blue** = up, **green** = up + PoE delivering, **grey** = down, **purple** = uplink, **red X / red border** = administratively disabled, **yellow highlight** = bulk selected
- Green dot indicator on ports actively delivering PoE power
- Click any port for detail popup — MAC address, hostname, IP, VLAN, admin state, PoE status, live PoE power, device type
- Users with write access to the selected switch can change access VLANs, shut/no-shut ports, and write memory directly from the visualiser
- **Bulk mode** — enable `Bulk Select` to select multiple ports at once; apply a VLAN change, shutdown, or no-shutdown to all selected ports in a single action. Uplink ports are excluded from bulk operations
- Users with `switchadmin:write` also get a `Manage Access` control to grant/revoke per-switch write access for other users
- Multi-switch stacks show all members simultaneously, one panel per switch
- Auto-refreshes every 120 seconds to reflect switch changes

### Notifications
- Bell icon opens an alert history panel showing the last 50 alerts with timestamps
- Browser push notifications for:
  - Interface down / back up
  - WireGuard peer disconnected / reconnected
  - CPU exceeds 90%
  - 100% ping loss to configured target

### Client Inventory
- Inventory data is built by correlating DHCP leases, ARP entries, and cached switch MAC table observations
- Adds vendor enrichment via OUI lookup with persistent host-mounted cache (`/app/oui-cache.json`)
- Tracks first seen and last seen timestamps per MAC address
- Shows online devices plus historical offline devices observed previously
- Includes per-device switch, port, VLAN, status, hostname, and IP when available
- Supports inline editing of inventory notes/tags per device
- Supports quick filtering by hostname, MAC, IP, switch, and online state

### Audit Log
- All state-changing operations are logged with timestamp, user, action, target, detail, and outcome
- Covers DHCP reserve/release, WireGuard mutations, switch write actions, user management, and permission changes
- Dedicated Audit Log page supports action/user/date filtering and incremental pagination

---

## Security

ROS-Dash includes built-in authentication, CSRF protection, and is suitable for deployment behind a reverse proxy with HTTPS.

**Key security features:**
- **CSRF protection** — all state-changing endpoints require valid CSRF tokens; same-site request forgery attacks are prevented
- **Input validation** — all write endpoints validate request bodies with zod schemas (DHCP, WireGuard, users, permissions); malformed requests rejected with 400 errors
- **Hardened secrets** — `DASH_SECRET` is required at startup (no weak fallback); session tokens use HMAC-SHA256 signing
- **Session validation** — 8-hour token expiry, automatic invalidation on server restart, per-page and per-switch access control
- **Protected WebSocket** — unauthenticated socket connections rejected at handshake
- **Consistent error responses** — shared error formatting utility prevents malformed `500` payloads and `[object Object]` log output

**Recommended setup:**
- Deploy behind Nginx Proxy Manager or similar with a valid SSL certificate
- Set `DASH_SECRET` to a strong random string (≥32 characters) in your `.env`
- Use a dedicated API user on the router with only the permissions it needs (see RouterOS Setup below)
- Keep `.env`, `switches.json`, and `ros-dash.db` outside the Docker image, mounted as volumes
- Never commit `.env` or `switches.json` to version control

---

## Deployment

### Docker (recommended)

Clone the repository:

```bash
git clone https://github.com/uniquestar/ROS-Dash.git
cd ROS-Dash
```

Create your config files on the server (these are never baked into the image):

```bash
cp .env.example .env
vim .env
```

**Required environment variables:**
- `DASH_SECRET` — a strong random string (≥32 characters) used to sign session tokens. Generate with: `openssl rand -base64 32`
- `ROUTER_HOST`, `ROUTER_PORT`, `ROUTER_USER`, `ROUTER_PASS` — RouterOS API credentials
- `WG_INTERFACE` — WireGuard interface name on RouterOS (default `WireGuard`)
- `WG_LIST_PREFIX` — firewall address-list prefix used for WireGuard groups (default `WG-`)
- `WG_SERVER_LISTEN_PORT` — server listen port written into generated client configs (default `13231`)
- `WG_ALLOWED_SUBNET` — allowed subnet used for peer address validation (default `192.168.168.0/24`)
- `WG_CLIENT_PREFIX` — client address prefix length (default `24`)
- `WG_CLIENT_DNS` — DNS server pushed to client configs (default `192.168.168.1`)
- `SWITCH_POLL_MS` — switch poll cadence in milliseconds (default `30000`)
- `SWITCH_MAX_PER_TICK` — max switches polled per cycle (default `2`)
- `SWITCH_POLL_TIMEOUT_MS` — per-switch timeout before backoff (default `15000`)

Create the database and your first admin user:
```bash
npm install
node src/add-user.js admin yourpassword admin
```

> **Note:** The database file (`ros-dash.db`) must exist on the host before starting the container. The `add-user.js` script will create it automatically. Ensure `DB_PATH=/app/ros-dash.db` is set in your `.env`.

Build and run:

```bash
docker build -t ros-dash .
docker run -d \
  --name ros-dash \
  --network host \
  --env-file /path/to/.env \
  --mount type=bind,source=/path/to/ros-dash.db,target=/app/ros-dash.db \
  --mount type=bind,source=/path/to/switches.json,target=/app/switches.json \
  --mount type=bind,source=/path/to/oui-cache.json,target=/app/oui-cache.json \
  --restart unless-stopped \
  ros-dash
```

Set `DB_PATH=/app/ros-dash.db` in your `.env` to ensure the database is written to the mounted path.
Create `/path/to/oui-cache.json` once on the host so OUI vendor lookups persist across container rebuilds.

- Dashboard: `http://your-server:3081`
- Health check: `http://your-server:3081/healthz`

### Updating

> **Important:** The build script checkpoints the SQLite WAL before stopping the container to ensure user data persists across rebuilds. If managing users manually via `docker exec`, always run the build script to deploy rather than restarting the container directly — this ensures the checkpoint runs correctly.

```bash
git pull
docker build -t ros-dash .
docker stop ros-dash && docker rm ros-dash
docker run -d \
  --name ros-dash \
  --network host \
  --env-file /path/to/.env \
  --mount type=bind,source=/path/to/ros-dash.db,target=/app/ros-dash.db \
  --mount type=bind,source=/path/to/switches.json,target=/app/switches.json \
  --mount type=bind,source=/path/to/oui-cache.json,target=/app/oui-cache.json \
  --restart unless-stopped \
  ros-dash
```

### Server Deployment Script

For automated deployment on the server, maintain a build script at a path outside the repo (e.g. `/opt/ros-dash/build-and-run.sh`). The script should:

1. Checkpoint the SQLite WAL before stopping the container
2. Pull the latest code from GitHub
3. Copy `.env` and `switches.json` into the repo directory
4. Build the Docker image
5. Stop and remove the old container
6. Start the new container with bind mounts for `ros-dash.db`, `switches.json`, and `oui-cache.json`
7. Verify the database has users after startup

Key points:
- Never store `.env`, `switches.json`, `ros-dash.db`, or `oui-cache.json` in the repo
- Always mount `ros-dash.db` as a bind mount — never bake it into the image
- The WAL checkpoint before stop is critical for user data persistence

---

## RouterOS Setup
ROS-Dash requires a RouterOS API user with appropriate permissions. If you only need read-only features, use the read-only group. If you want to use DHCP reservation (Reserve/Release buttons), the API user needs write access too.

**Read-only (no DHCP reservation):**
```
/user/group/add name=api-readonly policy=read,api,test
/user/add name=rosdash group=api-readonly password=your-secure-password
```

**Read-write (required for DHCP reservation):**
```
/user/group/add name=api-readwrite policy=read,write,api,test,sensitive,password,policy,ssh,ftp
/user/add name=rosdash group=api-readwrite password=your-secure-password
```

```

To use API-SSL (TLS), enable the ssl service and set `ROUTER_TLS=true` in your `.env`:

```
/ip/service/set api-ssl disabled=no port=8729
```

---

## Switch Setup

Switch integration requires SNMPv2c read access on each Cisco Catalyst switch.

### Enable SNMP on each switch

```
snmp-server community YOUR_COMMUNITY RO
access-list 10 permit YOUR_MANAGEMENT_SUBNET
snmp-server community YOUR_COMMUNITY RO 10

# Optional (required for VLAN write operations from ROS-Dash)
snmp-server community YOUR_COMMUNITY_RW RW 10
```

### switches.json

Create `switches.json` in the project root (or on the server alongside `.env`). This file is gitignored and never baked into the Docker image.

```json
{
  "switches": [
    {
      "name": "CoreSwitch",
      "ip": "10.0.0.2",
      "community": "your-community",
      "writeCommunity": "your-rw-community",
      "mikrotikInterface": "2 - Core",
      "defaultVlan": 100,
      "uplinkPorts": ["Gi1/0/48"]
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Display name shown in the dashboard |
| `ip` | Management IP of the switch |
| `community` | SNMPv2c community string |
| `writeCommunity` | SNMPv2c write community used for switch write actions such as VLAN changes, port disable/enable, and write memory (optional; leave empty/omit to disable writes) |
| `mikrotikInterface` | Mikrotik interface name this switch connects to — used to discover VLANs dynamically |
| `defaultVlan` | Native/default VLAN on the switch (not reflected in Mikrotik VLAN config) |
| `poePowerDivisor` | Optional fallback divisor for switch models that report Cisco PoE fallback values in non-watt units |
| `uplinkPorts` | Uplink port name(s) — shown in visualiser as uplinks, excluded from MAC table |

VLANs are discovered automatically from `/interface/vlan/print` on the Mikrotik — any new VLANs added to the router will be picked up without changing `switches.json`.

For stacked switches, configure each stack as a single entry — ROS-Dash detects the number of stack members automatically and displays each switch as a separate panel in the visualiser.

---

## User Management

Add users via the CLI (works both locally and inside the container):
```bash
node src/add-user.js <username> <password> [role]
# role: admin or viewer (default: viewer)
```

To manage users on the Docker server:
```bash
sudo docker exec -it ros-dash node src/add-user.js admin yourpassword admin
```

Or via the web UI at the Users page (requires users:write permission).

Permissions are configured per user per page via the Users page. Per-page permission changes take effect on the user's next login.

For switch management, access is split into two layers:

- `switches:read` lets the user view the Switches page and open the visualiser
- `switchadmin:write` lets the user manage per-switch write access for other users from the `Manage Access` button on the Switches page
- Per-switch write grants let a user operate only the switches explicitly allowed to them

Typical setup:

- Give operational users `switches:read`
- Treat `switches:write` as separate page permission metadata; actual switch write actions are controlled by `switchadmin:write` or per-switch grants
- Give only senior admins `switchadmin:write`
- Use `Manage Access` on the Switches page to grant specific switches to specific users

Per-switch write grants are enforced live and do not require the target user to log out and back in again.

> **Note:** User data is stored in `ros-dash.db` using SQLite WAL mode. The app checkpoints the WAL on shutdown to ensure data persists. Always use the build script to redeploy rather than manually restarting the container.

---

## Environment Variables

```env
PORT=3081                    # HTTP port ROS-Dash listens on
DASH_SECRET=replace-with-a-long-random-secret-at-least-32-chars
ROUTER_HOST=192.168.88.1     # RouterOS IP or hostname
ROUTER_PORT=8729             # API port (8728 plain, 8729 TLS)
ROUTER_TLS=false             # Set true to use API-SSL
ROUTER_TLS_INSECURE=false    # Skip TLS cert verification (self-signed certs)
ROUTER_USER=mikrodash        # API username
ROUTER_PASS=change-me        # API password
DEFAULT_IF=WAN1              # Default WAN interface for traffic chart
HISTORY_MINUTES=30           # Traffic chart history window

# WireGuard
WG_INTERFACE=WireGuard
WG_LIST_PREFIX=WG-
WG_SERVER_LISTEN_PORT=13231
WG_ALLOWED_SUBNET=192.168.168.0/24
WG_CLIENT_PREFIX=24
WG_CLIENT_DNS=192.168.168.1

# Polling intervals (ms)
CONNS_POLL_MS=3000
KIDS_POLL_MS=3000
DHCP_POLL_MS=15000
LEASES_POLL_MS=15000
ARP_POLL_MS=30000
SYSTEM_POLL_MS=3000
WIRELESS_POLL_MS=5000
VPN_POLL_MS=10000
FIREWALL_POLL_MS=10000
IFSTATUS_POLL_MS=5000
PING_POLL_MS=10000
SWITCH_POLL_MS=30000

# Switch polling safety knobs for older stacks
SWITCH_MAX_PER_TICK=2
SWITCH_POLL_TIMEOUT_MS=15000

# Ping target for latency monitor
PING_TARGET=1.1.1.1

# Top-N limits
TOP_N=10
TOP_TALKERS_N=5
FIREWALL_TOP_N=15
ROS_DEBUG=false
```

---

## Architecture

### Streamed (router pushes on change)
| Data | RouterOS endpoint |
|---|---|
| WAN Traffic RX/TX | `/interface/monitor-traffic` |
| Router Logs | `/log/listen` |
| DHCP Lease changes | `/ip/dhcp-server/lease/listen` |

### Polled — RouterOS (concurrent via tagged API multiplexing)
| Collector | Interval | Data |
|---|---|---|
| System | 3s | CPU, RAM, storage, temp, ROS version |
| Connections | 3s | Firewall connection table, geo-IP |
| Interface Status | 5s | Interface state, IPs, rx/tx bytes |
| WAN IPs | 30s | All IPs on WAN interface |
| VPN | 10s | WireGuard peers, rx/tx rates |
| Firewall | 10s | Rule hit counts |
| Ping | 10s | RTT + packet loss to PING_TARGET |
| DHCP Networks | 15s | LAN subnets, VLAN discovery |
| DHCP Leases | 15s | Active lease table |
| ARP | 30s | MAC to IP mappings |
| IP Neighbours | 60s | CDP/LLDP neighbour discovery |
| Routes | 30s | Active routing table |
| Address Lists | 60s | Firewall address lists |

### Polled — Cisco Switches (SNMP)
| Collector | Interval | Data |
|---|---|---|
| Switches | `SWITCH_POLL_MS` (30s default) | Batched MAC tables, port status, PoE status and device descriptions |

All RouterOS collectors run **concurrently** on a single persistent TCP connection.

Collector and server error formatting is centralized via [src/util/errors.js](src/util/errors.js), used by collectors, RouterOS client, retry logic, DB migration paths, and API catch blocks.

---

## Keyboard Shortcuts

| Key | Page |
|---|---|
| `1` | Dashboard |
| `3` | Interfaces |
| `4` | DHCP |
| `5` | VPN |
| `6` | Connections |
| `7` | Firewall |
| `8` | Logs |
| `/` | Focus log search |

---

## Credits

Forked from [MikroDash](https://github.com/SecOps-7/MikroDash) by SecOps-7. Significant enhancements by [uniquestar](https://github.com/uniquestar).

---

## License

MIT — see [LICENSE](LICENSE)

Third-party attributions — see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)

---

## Disclaimer

ROS-Dash is an independent, community-built project and is **not affiliated with, endorsed by, or associated with MikroTik SIA, Cisco Systems, Inc., or their affiliates** in any way. MikroTik, RouterOS, Cisco, and Catalyst are trademarks of their respective owners. All other product names, logos, and trademarks referenced by this project remain the property of their respective owners.
