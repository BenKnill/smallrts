# Single‑File WebRTC Game (No Domain, Self‑Signed HTTPS/WSS)

**Goal:** Ship one **self‑contained HTML file** that friends can open in Firefox. One person clicks **Host**, gets a **shareable link** (to the host's IP/port), and others join. **No domains. No installers.** Signaling rides over **self‑signed HTTPS/WSS** on the host's public or LAN IP. Game data flows over **WebRTC DataChannels** (P2P). Target up to **10 players**.

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd smallrts

# Build and run (one command does it all!)
make serve

# Or step by step:
make build           # Creates index.html (single file with everything)
make cert            # Generates self-signed certificate
npm run serve        # Starts HTTPS/WSS server on port 8443
```

**To play:**
1. Host opens `https://<your-ip>:8443` in Firefox
2. Accept the security warning (self-signed cert)
3. Click "Host Game" to create a room
4. Share the displayed link with friends
5. Friends open the link, accept warning, click "Join"
6. Host clicks "Start Game"
7. Play! Left-click to select units, right-click to move them

**Requirements:**
- Node.js 16+ (for building and running the server)
- OpenSSL (for generating certificates)
- Firefox recommended (Chrome requires additional cert trust setup)

---

> This README is written as a runbook for an *agent* (automation or human) to execute. It lays out constraints, decisions, tasks, and acceptance tests.

---

## 0) Non‑Negotiable Constraints

* **One HTML file** (can be arbitrarily large). All JS/CSS/assets must be inlined.
* **No domain name.** Host exposes `https://<host-ip>:<port>` with a **self‑signed cert**.
* **Firefox flow is acceptable**: users click *Advanced → Accept the Risk and Continue* once per `ip:port`.
* **No OS‑level installs for joiners.** Host may run a tiny HTTPS+WSS relay process (single binary/script).

Out of scope: NAT traversal guarantees for every hostile network (we will not require TURN by default), persistence/backends, user accounts.

---

## 1) Architecture (High‑Level)

```
[ Single HTML File ]  ───(HTTPS, same origin)──▶  [ Host HTTPS server ] ── upgrade ──▶  WSS /signal
          │                                                            (signaling only)
          └── WebRTC DataChannels ◀──────────── P2P between peers (host ⇄ guests)
```

* **Signaling Relay (host)**: One process serves the HTML at `/` and upgrades `/signal` to **WSS**. It only relays small JSON blobs (offer/answer/ICE, room control). **Same port & cert** as the page → users accept one security exception.
* **P2P Game Data**: After signaling, gameplay runs **host‑centric star** over WebRTC DataChannels (host authoritative). Two channels per peer: `reliable` for snapshots/critical RPCs, `fast` (unordered, maxRetransmits=0) for input spam.
* **STUN**: Use public STUN (e.g., Google) to get server‑reflexive candidates. No TURN by default.

---

## 2) User Flow (Host & Guests)

1. **Host** runs the relay (`https://<host-ip>:8443`).
2. **Host** opens `/` in Firefox, accepts the self‑signed warning, clicks **Host**.
3. Page creates a room (e.g., `abcd`) via WSS and shows a shareable link: `https://<host-ip>:8443/?room=abcd`.
4. **Guests** open the link in Firefox, accept the warning, click **Join**.
5. Signaling happens over WSS; WebRTC connects; game starts.

**Fallback**: optional *Manual/QR signaling* mode for environments where WSS is blocked (copy‑paste SDP). Keep this inside the same HTML file.

---

## 3) Security & Certificates (Self‑Signed for IP)

**Why**: We need a *secure context* to use WebRTC and to avoid mixed content; trust via CA is not required.

**Deliverable**: Agent generates a self‑signed cert whose **SubjectAltName (SAN)** includes the host’s IP.

* Create `openssl.cnf` (replace `203.0.113.42` with real host IP):

```ini
[ req ]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_req

[ dn ]
CN = 203.0.113.42

[ v3_req ]
subjectAltName = @alt_names

[ alt_names ]
IP.1 = 203.0.113.42
```

* Generate cert (valid 365 days):

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem -days 365 -config openssl.cnf
```

**Notes**

* Serve **page and WSS on the same `ip:port` & cert** to avoid a second warning.
* Expect one click‑through per guest per `ip:port` in Firefox. Chrome users must pre‑trust the cert via settings (document as “Firefox recommended”).

---

## 4) Networking & Reliability

* **STUN**: Inline config `iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]`.
* **NAT Edge Cases**: Some strict networks may fail to connect without TURN. Provide optional env var to enable TURN later (not default). Document known limitations.
* **LAN Mode**: If everyone is on the same LAN, connections are near‑guaranteed. Provide a quick LAN‑host script example.

---

## 5) Game Transport & Cheating Model

* **Host authoritative**: Clients send *inputs* only (`select`, `move`, `build`), never state. Host simulates and broadcasts.
* **Channels**:

  * `fast` (unordered, `maxRetransmits: 0`): high‑rate inputs, 30–60 Hz.
  * `reliable` (default): state snapshots (10–20 Hz), control messages, join/leave, chat.
* **Latency handling**:

  * RTS‑style **lockstep** (deterministic, slower but simple), or
  * **Prediction + reconciliation** for unit selection/movement (snappier). Start with lockstep for MVP.

**Back‑of‑envelope bandwidth (10 players)**

* Inputs: ~20 bytes * 30 Hz * 9 guests ≈ **5.4 kB/s uplink** to host.
* Snapshots: ~1200 bytes * 15 Hz * 9 ≈ **145 kB/s uplink** from host. Within typical consumer uplinks.

---

## 6) Message Protocol (JSON over WSS for signaling; user packets over DataChannels)

### Signaling (WSS)

```jsonc
// Client → server
{ "type": "create" }                                  // host creates room
{ "type": "join", "room": "abcd" }                 // guest joins room
{ "type": "signal", "room": "abcd", "to": "peerId|host", "payload": { /* SDP/ICE */ } }
{ "type": "leave", "room": "abcd" }

// Server → client
{ "type": "created", "room": "abcd", "self": "peerId" }
{ "type": "joined",  "room": "abcd", "self": "peerId" }
{ "type": "peers",   "room": "abcd", "peers": ["peerId1", ...] }
{ "type": "signal",  "from": "peerId|host", "payload": { /* SDP/ICE */ } }
{ "type": "left",    "peer": "peerId" }
{ "type": "error",   "code": "room_full|not_found|...", "message": "..." }
```

### DataChannels (host ⇄ guest)

* **`fast`** (unordered, maxRetransmits=0):

```jsonc
{ "t": "in",  "seq": 123, "frame": 456, "cmd": [ ["select", unitIds], ["move", x, y] ] }
```

* **`reliable`**:

```jsonc
{ "t": "snap", "tick": 789, "units": [ {"id":1, "x":10, "y":20, "hp":100, ...} ], "you": "peerId" }
{ "t": "ack",  "seq": 123 }
{ "t": "sys",  "kind": "pause|resume|chat", ... }
```

---

## 7) Relay Server (Two Tiny Options)

> The relay’s only job is to create rooms and *relay* `signal` messages. No persistence.

### A) Node.js (HTTPS + `ws`) — ~40 lines

```js
// server.js
import fs from 'fs';
import https from 'https';
import { WebSocketServer } from 'ws';

const cert = { key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') };
const server = https.createServer(cert, (req, res) => {
  // Serve the single HTML file regardless of path
  const html = fs.readFileSync('index.html', 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

const wss = new WebSocketServer({ server, path: '/signal' });
const rooms = new Map(); // roomId -> Map(peerId -> ws)

function send(ws, o){ try { ws.send(JSON.stringify(o)); } catch(_){} }
function broadcast(room, exceptId, o){ for (const [pid, s] of room) if (pid!==exceptId) send(s,o); }

wss.on('connection', (ws) => {
  let roomId = null, peerId = Math.random().toString(36).slice(2,8);
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'create') {
      roomId = Math.random().toString(36).slice(2,6);
      rooms.set(roomId, new Map([[peerId, ws]]));
      send(ws, { type:'created', room: roomId, self: peerId });
    } else if (msg.type === 'join') {
      const room = rooms.get(msg.room); if(!room){ return send(ws,{type:'error',code:'not_found'}); }
      roomId = msg.room; room.set(peerId, ws);
      send(ws, { type:'joined', room: roomId, self: peerId });
      send(ws, { type:'peers', room: roomId, peers: [...room.keys()] });
      broadcast(room, peerId, { type:'peers', room: roomId, peers: [...room.keys()] });
    } else if (msg.type === 'signal') {
      const room = rooms.get(msg.room); if(!room) return;
      if (msg.to === 'host') { // assume creator is the first key
        const hostId = [...room.keys()][0];
        const host = room.get(hostId); if(host) send(host,{type:'signal', from: peerId, payload: msg.payload});
      } else {
        const dest = room.get(msg.to); if(dest) send(dest,{type:'signal', from: peerId, payload: msg.payload});
      }
    }
  });
  ws.on('close', () => {
    const room = rooms.get(roomId); if(!room) return;
    room.delete(peerId); broadcast(room, peerId, { type:'left', peer: peerId });
    if(room.size===0) rooms.delete(roomId);
  });
});

server.listen(8443, () => console.log('https://<host-ip>:8443'));
```

### B) Python (`websockets`) — compact TLS relay

```python
# server.py
import asyncio, json, ssl, pathlib, secrets
import websockets

rooms = {}
async def handler(ws):
    peer = secrets.token_hex(3)
    room = None
    try:
        async for raw in ws:
            m = json.loads(raw)
            if m['type']=='create':
                room = secrets.token_hex(2)
                rooms[room] = {peer: ws}
                await ws.send(json.dumps({'type':'created','room':room,'self':peer}))
            elif m['type']=='join':
                r = rooms.get(m['room'])
                if not r: return await ws.send(json.dumps({'type':'error','code':'not_fou
```
