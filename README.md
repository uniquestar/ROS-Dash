# ROS-Dash
### A MikroTik RouterOS v7 Live Dashboard

> Real-time MikroTik RouterOS v7 dashboard — streaming binary API, Socket.IO, Docker-ready.

ROS-Dash connects directly to the RouterOS API over a persistent binary TCP connection, streaming live data to the browser via Socket.IO. No page refreshes. No agents. Built-in authentication, multi-user support, and Cisco switch integration.

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
- **WireGuard card** — active peer list with accurate connection status (peers with no handshake in 5 minutes shown as offline)

### Pages
| Page | Description |
|---|---|
| Interfaces | All interfaces as compact tiles with status, IP, live rates, and cumulative RX/TX totals |
| DHCP | Active DHCP leases with hostname, IP, MAC, status, lease type, and switch port location |
| VPN | All WireGuard peers (active + idle) as tiles sorted active-first, with allowed IPs, endpoint, handshake, and traffic counters |
| Connections | World map with animated arcs to destination countries, per-country protocol breakdown, top ports panel, and click-through connection detail modal |
| Switches | Per-switch port allocation table showing switch, port, MAC, hostname, IP, and VLAN — populated via SNMP |
| Firewall *(admin only)* | Top hits, Filter, NAT, and Mangle rule tables with packet counts |
| Logs | Live router log stream with severity filter and text search |
| Users *(admin only)* | User management — add, delete, change passwords and roles |

### Authentication & Access Control
- **Login page** with username/password authentication
- **Session tokens** — HMAC-signed, 8-hour expiry
- **Multi-user support** — users stored in `users.json` with PBKDF2 hashed passwords
- **Role-based access** — `admin` and `viewer` roles
- **Admin-only pages** — Firewall and User Management restricted to admin users
- **Protected WebSocket** — unauthenticated socket connections rejected server-side

### Cisco Switch Integration
ROS-Dash can poll Cisco Catalyst switches via SNMPv2c to build a complete port allocation map, cross-referenced with DHCP leases and ARP tables for hostname and IP resolution.

- Polls MAC address tables per VLAN via VLAN-context SNMP (`community@vlan`)
- VLANs discovered dynamically from Mikrotik VLAN interface config — no need to hardcode
- Uplink ports excluded from reporting
- Results surfaced on the Switches page and inline on the DHCP page (Switch + Port columns)
- Configured via `switches.json` (see Switch Setup below)

### Notifications
- Bell icon opens an alert history panel showing the last 50 alerts with timestamps
- Browser push notifications for:
  - Interface down / back up
  - WireGuard peer disconnected / reconnected
  - CPU exceeds 90%
  - 100% ping loss to configured target

---

## Security

ROS-Dash includes built-in authentication and is suitable for deployment behind a reverse proxy with HTTPS.

**Recommended setup:**
- Deploy behind Nginx Proxy Manager or similar with a valid SSL certificate
- Use a dedicated read-only API user on the router (see RouterOS Setup below)
- Keep `users.json`, `.env`, and `switches.json` outside the Docker image, mounted as volumes
- Never commit `.env`, `users.json`, or `switches.json` to version control

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

Create your first admin user:

```bash
npm install
node src/add-user.js admin yourpassword admin
```

Build and run:

```bash
docker build -t ros-dash .
docker run -d \
  --name ros-dash \
  --network host \
  --env-file /path/to/.env \
  --mount type=bind,source=/path/to/users.json,target=/app/users.json \
  --mount type=bind,source=/path/to/switches.json,target=/app/switches.json \
  --restart unless-stopped \
  ros-dash
```

- Dashboard: `http://your-server:3081`
- Health check: `http://your-server:3081/healthz`

### Updating

```bash
git pull
docker build -t ros-dash .
docker stop ros-dash && docker rm ros-dash
docker run -d \
  --name ros-dash \
  --network host \
  --env-file /path/to/.env \
  --mount type=bind,source=/path/to/users.json,target=/app/users.json \
  --mount type=bind,source=/path/to/switches.json,target=/app/switches.json \
  --restart unless-stopped \
  ros-dash
```

---

## RouterOS Setup

Create a read-only API user (recommended):

```
/user/group/add name=api-readonly policy=read,api,test
/user/add name=rosdash group=api-readonly password=your-secure-password
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
| `mikrotikInterface` | Mikrotik interface name this switch is connected to — used to discover VLANs dynamically |
| `defaultVlan` | Native/default VLAN on the switch (not reflected in Mikrotik VLAN config) |
| `uplinkPorts` | Ports to exclude from reporting (uplinks back to Mikrotik) |

VLANs are discovered automatically from `/interface/vlan/print` on the Mikrotik — any new VLANs added to the router will be picked up without changing `switches.json`.

---

## User Management

Add users via the CLI:

```bash
node src/add-user.js <username> <password> [role]
# role: admin or viewer (default: viewer)
```

Or via the web UI at `/users` (admin login required).

---

## Environment Variables

```env
PORT=3081                    # HTTP port ROS-Dash listens on
ROUTER_HOST=192.168.88.1     # RouterOS IP or hostname
ROUTER_PORT=8728             # API port (8728 plain, 8729 TLS)
ROUTER_TLS=false             # Set true to use API-SSL
ROUTER_TLS_INSECURE=false    # Skip TLS cert verification (self-signed certs)
ROUTER_USER=rosdash          # API username
ROUTER_PASS=change-me        # API password
DEFAULT_IF=ether1            # Default WAN interface for traffic chart
HISTORY_MINUTES=30           # Traffic chart history window
DASH_SECRET=                 # Random string for session token signing

# Polling intervals (ms)
CONNS_POLL_MS=3000
DHCP_POLL_MS=15000
LEASES_POLL_MS=15000
ARP_POLL_MS=30000
SYSTEM_POLL_MS=3000
VPN_POLL_MS=10000
FIREWALL_POLL_MS=10000
IFSTATUS_POLL_MS=5000
PING_POLL_MS=10000

# Ping target for latency monitor
PING_TARGET=1.1.1.1

# Top-N limits
TOP_N=10
TOP_TALKERS_N=5
FIREWALL_TOP_N=15
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

### Polled — Cisco Switches (SNMP)
| Collector | Interval | Data |
|---|---|---|
| Switches | 120s | MAC address tables per VLAN, port allocations |

All RouterOS collectors run **concurrently** on a single TCP connection.

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

ROS-Dash is an independent, community-built project and is **not affiliated with, endorsed by, or associated with MikroTik SIA** in any way. MikroTik and RouterOS are trademarks of MikroTik SIA. All product names and trademarks are the property of their respective owners.
