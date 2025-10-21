// SmallRTS - Single-file WebRTC RTS Game
// Architecture: Host-authoritative star topology over WebRTC DataChannels

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_PLAYERS = 10;

class SignalingClient {
  constructor(onMessage) {
    this.ws = null;
    this.roomId = null;
    this.peerId = null;
    this.onMessage = onMessage;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}/signal`);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        this.onMessage(msg);
      };
      this.ws.onclose = () => {
        console.log('Signaling connection closed');
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  createRoom() {
    this.send({ type: 'create' });
  }

  joinRoom(roomId) {
    this.send({ type: 'join', room: roomId });
  }

  signal(to, payload) {
    this.send({ type: 'signal', room: this.roomId, to, payload });
  }
}

class PeerConnection {
  constructor(peerId, isHost, onChannel, onClose) {
    this.peerId = peerId;
    this.isHost = isHost;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.onChannelReady = onChannel;
    this.onClose = onClose;
    this.channels = {};
    this.iceCandidates = [];

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.iceCandidates.push(e.candidate);
      }
    };

    this.pc.ondatachannel = (e) => {
      this.setupChannel(e.channel);
    };

    this.pc.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state: ${this.pc.connectionState}`);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.onClose(peerId);
      }
    };
  }

  setupChannel(channel) {
    this.channels[channel.label] = channel;
    channel.onopen = () => {
      console.log(`Channel ${channel.label} opened with ${this.peerId}`);
      if (this.channels.reliable && this.channels.fast) {
        this.onChannelReady(this);
      }
    };
  }

  createChannels() {
    this.setupChannel(this.pc.createDataChannel('reliable', { ordered: true }));
    this.setupChannel(this.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
  }

  async createOffer() {
    this.createChannels();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return { sdp: offer, candidates: this.iceCandidates };
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return { sdp: answer, candidates: this.iceCandidates };
  }

  async handleOffer(payload) {
    await this.pc.setRemoteDescription(payload.sdp);
    if (payload.candidates) {
      for (const candidate of payload.candidates) {
        await this.pc.addIceCandidate(candidate);
      }
    }
  }

  async handleAnswer(payload) {
    await this.pc.setRemoteDescription(payload.sdp);
    if (payload.candidates) {
      for (const candidate of payload.candidates) {
        await this.pc.addIceCandidate(candidate);
      }
    }
  }

  send(channel, data) {
    if (this.channels[channel] && this.channels[channel].readyState === 'open') {
      this.channels[channel].send(JSON.stringify(data));
    }
  }

  close() {
    this.pc.close();
  }
}

class NetworkManager {
  constructor(isHost, game) {
    this.isHost = isHost;
    this.game = game;
    this.signaling = new SignalingClient(this.handleSignal.bind(this));
    this.peers = new Map();
    this.ready = false;
  }

  async init() {
    await this.signaling.connect();
    updateStatus('Connected to signaling server', true);
  }

  handleSignal(msg) {
    console.log('Signaling message:', msg);

    if (msg.type === 'created') {
      this.signaling.roomId = msg.room;
      this.signaling.peerId = msg.self;
      showShareLink(msg.room);
      updateStatus(`Room created: ${msg.room}`, true);
    } else if (msg.type === 'joined') {
      this.signaling.roomId = msg.room;
      this.signaling.peerId = msg.self;
      updateStatus(`Joined room: ${msg.room}`, true);
    } else if (msg.type === 'peers') {
      this.handlePeersList(msg.peers);
    } else if (msg.type === 'signal') {
      this.handlePeerSignal(msg.from, msg.payload);
    } else if (msg.type === 'left') {
      this.handlePeerLeft(msg.peer);
    } else if (msg.type === 'error') {
      updateStatus(`Error: ${msg.code}`, false);
    }
  }

  handlePeersList(peers) {
    updatePlayersList(peers);

    if (this.isHost) {
      // Host initiates connections to all guests
      for (const peerId of peers) {
        if (peerId !== this.signaling.peerId && !this.peers.has(peerId)) {
          this.connectToPeer(peerId);
        }
      }
      document.getElementById('start-btn').style.display = 'block';
    } else {
      // Guest waits for host to connect
      // The host is always the first peer
      const hostId = peers[0];
      if (hostId !== this.signaling.peerId && !this.peers.has(hostId)) {
        // Just wait for the offer from host
      }
    }
  }

  async connectToPeer(peerId) {
    console.log('Connecting to peer:', peerId);
    const peer = new PeerConnection(
      peerId,
      this.isHost,
      this.onPeerReady.bind(this),
      this.onPeerClose.bind(this)
    );
    this.peers.set(peerId, peer);

    const offer = await peer.createOffer();
    this.signaling.signal(peerId, { type: 'offer', ...offer });
  }

  async handlePeerSignal(from, payload) {
    if (payload.type === 'offer') {
      let peer = this.peers.get(from);
      if (!peer) {
        peer = new PeerConnection(
          from,
          this.isHost,
          this.onPeerReady.bind(this),
          this.onPeerClose.bind(this)
        );
        this.peers.set(from, peer);
      }
      await peer.handleOffer(payload);
      const answer = await peer.createAnswer();
      this.signaling.signal(from, { type: 'answer', ...answer });
    } else if (payload.type === 'answer') {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.handleAnswer(payload);
      }
    }
  }

  onPeerReady(peer) {
    console.log('Peer ready:', peer.peerId);

    // Setup message handlers
    peer.channels.reliable.onmessage = (e) => this.handleGameMessage(peer, JSON.parse(e.data));
    peer.channels.fast.onmessage = (e) => this.handleGameMessage(peer, JSON.parse(e.data));

    if (this.isHost) {
      this.game.addPlayer(peer.peerId);
    }
  }

  handleGameMessage(peer, msg) {
    if (this.isHost) {
      // Host receives inputs from guests
      if (msg.t === 'in') {
        this.game.handleInput(peer.peerId, msg.cmd);
      }
    } else {
      // Guest receives state from host
      if (msg.t === 'snap') {
        this.game.handleSnapshot(msg);
      }
    }
  }

  onPeerClose(peerId) {
    console.log('Peer closed:', peerId);
    this.peers.delete(peerId);
    this.game.removePlayer(peerId);
  }

  handlePeerLeft(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
    this.game.removePlayer(peerId);
  }

  broadcast(channel, data) {
    for (const peer of this.peers.values()) {
      peer.send(channel, data);
    }
  }

  sendToHost(channel, data) {
    // Assumes first peer is the host
    const host = Array.from(this.peers.values())[0];
    if (host) {
      host.send(channel, data);
    }
  }

  createRoom() {
    this.signaling.createRoom();
  }

  joinRoom(roomId) {
    this.signaling.joinRoom(roomId);
  }
}

class Unit {
  constructor(id, x, y, owner) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.targetX = x;
    this.targetY = y;
    this.hp = 100;
    this.maxHp = 100;
    this.speed = 2;
    this.selected = false;
  }

  update() {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.speed) {
      this.x += (dx / dist) * this.speed;
      this.y += (dy / dist) * this.speed;
    } else {
      this.x = this.targetX;
      this.y = this.targetY;
    }
  }

  moveTo(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  serialize() {
    return {
      id: this.id,
      x: Math.round(this.x),
      y: Math.round(this.y),
      tx: Math.round(this.targetX),
      ty: Math.round(this.targetY),
      hp: this.hp,
      owner: this.owner
    };
  }
}

class Game {
  constructor(isHost, network) {
    this.isHost = isHost;
    this.network = network;
    this.units = new Map();
    this.players = new Map();
    this.tick = 0;
    this.nextUnitId = 1;
    this.running = false;
    this.myPlayerId = null;
    this.selection = new Set();

    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.setupInput();
  }

  setupInput() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 0) {
      // Left click - select units
      this.selectUnitsAt(x, y);
    } else if (e.button === 2) {
      // Right click - move selected units
      if (this.selection.size > 0) {
        this.issueCommand(['move', Math.round(x), Math.round(y)]);
      }
    }
  }

  selectUnitsAt(x, y) {
    this.selection.clear();
    for (const unit of this.units.values()) {
      if (unit.owner === this.myPlayerId) {
        const dist = Math.sqrt((unit.x - x) ** 2 + (unit.y - y) ** 2);
        if (dist < 20) {
          this.selection.add(unit.id);
          unit.selected = true;
        } else {
          unit.selected = false;
        }
      }
    }
    this.updateSelectedInfo();
  }

  updateSelectedInfo() {
    const info = document.getElementById('selected-info');
    info.textContent = this.selection.size > 0 ? `Selected: ${this.selection.size} units` : '';
  }

  issueCommand(cmd) {
    if (this.isHost) {
      this.executeCommand(this.myPlayerId, cmd);
    } else {
      this.network.sendToHost('fast', { t: 'in', cmd: [cmd] });
    }
  }

  executeCommand(playerId, cmd) {
    const [action, ...args] = cmd;

    if (action === 'move') {
      const [x, y] = args;
      for (const unitId of this.selection) {
        const unit = this.units.get(unitId);
        if (unit && unit.owner === playerId) {
          unit.moveTo(x, y);
        }
      }
    }
  }

  handleInput(playerId, commands) {
    for (const cmd of commands) {
      this.executeCommand(playerId, cmd);
    }
  }

  addPlayer(playerId) {
    console.log('Adding player:', playerId);
    this.players.set(playerId, { id: playerId, color: this.getPlayerColor(playerId) });

    // Spawn starting units for the player
    if (this.isHost) {
      const startX = 100 + this.players.size * 100;
      const startY = 100 + this.players.size * 80;

      for (let i = 0; i < 3; i++) {
        const unit = new Unit(
          this.nextUnitId++,
          startX + i * 30,
          startY,
          playerId
        );
        this.units.set(unit.id, unit);
      }
    }

    this.updatePlayerCount();
  }

  removePlayer(playerId) {
    console.log('Removing player:', playerId);
    this.players.delete(playerId);

    // Remove their units
    for (const [id, unit] of this.units) {
      if (unit.owner === playerId) {
        this.units.delete(id);
      }
    }

    this.updatePlayerCount();
  }

  getPlayerColor(playerId) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];
    const hash = playerId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  updatePlayerCount() {
    document.getElementById('player-count').textContent = this.players.size + (this.myPlayerId ? 1 : 0);
  }

  start(playerId) {
    this.myPlayerId = playerId;
    this.running = true;

    // Add self as player
    if (this.isHost) {
      this.addPlayer(playerId);
    }

    // Switch to game screen
    document.getElementById('menu').classList.remove('active');
    document.getElementById('game').classList.add('active');

    this.gameLoop();
  }

  gameLoop() {
    if (!this.running) return;

    if (this.isHost) {
      // Update game state
      this.tick++;
      for (const unit of this.units.values()) {
        unit.update();
      }

      // Send snapshot to all guests (15 Hz)
      if (this.tick % 4 === 0) {
        const snapshot = {
          t: 'snap',
          tick: this.tick,
          units: Array.from(this.units.values()).map(u => u.serialize())
        };
        this.network.broadcast('reliable', snapshot);
      }
    }

    this.render();
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  handleSnapshot(snap) {
    this.tick = snap.tick;

    // Update units from snapshot
    const newUnits = new Map();
    for (const data of snap.units) {
      let unit = this.units.get(data.id);
      if (!unit) {
        unit = new Unit(data.id, data.x, data.y, data.owner);
      }
      unit.x = data.x;
      unit.y = data.y;
      unit.targetX = data.tx;
      unit.targetY = data.ty;
      unit.hp = data.hp;
      newUnits.set(data.id, unit);
    }
    this.units = newUnits;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < this.canvas.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }

    // Draw units
    for (const unit of this.units.values()) {
      const color = this.players.get(unit.owner)?.color || '#fff';

      // Draw movement path
      if (unit.x !== unit.targetX || unit.y !== unit.targetY) {
        ctx.strokeStyle = color;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(unit.x, unit.y);
        ctx.lineTo(unit.targetX, unit.targetY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw unit
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, 12, 0, Math.PI * 2);
      ctx.fill();

      // Draw selection circle
      if (unit.selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw HP bar
      ctx.fillStyle = '#000';
      ctx.fillRect(unit.x - 12, unit.y - 20, 24, 4);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(unit.x - 12, unit.y - 20, 24 * (unit.hp / unit.maxHp), 4);
    }
  }
}

// UI Functions
function updateStatus(text, connected) {
  const status = document.getElementById('connection-status');
  status.textContent = text;
  if (connected) {
    status.classList.add('connected');
  } else {
    status.classList.remove('connected');
  }
}

function showShareLink(roomId) {
  const shareSection = document.getElementById('share-link');
  const shareUrl = document.getElementById('share-url');
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  shareUrl.value = url;
  shareSection.style.display = 'block';
  document.getElementById('lobby').style.display = 'block';
}

function updatePlayersList(peers) {
  const list = document.getElementById('players-list');
  list.innerHTML = '<h4>Players:</h4>' + peers.map(p => `<div>• ${p}</div>`).join('');
}

// Main application
let network = null;
let game = null;

document.getElementById('host-btn').addEventListener('click', async () => {
  const isHost = true;
  network = new NetworkManager(isHost, null);
  await network.init();
  network.createRoom();

  game = new Game(isHost, network);
  network.game = game;

  document.getElementById('host-btn').disabled = true;
  document.getElementById('join-btn').disabled = true;
});

document.getElementById('join-btn').addEventListener('click', async () => {
  const roomInput = document.getElementById('room-input');
  const roomId = roomInput.value.trim() || new URLSearchParams(location.search).get('room');

  if (!roomId) {
    alert('Please enter a room code');
    return;
  }

  const isHost = false;
  network = new NetworkManager(isHost, null);
  await network.init();
  network.joinRoom(roomId);

  game = new Game(isHost, network);
  network.game = game;

  document.getElementById('host-btn').disabled = true;
  document.getElementById('join-btn').disabled = true;
});

document.getElementById('start-btn').addEventListener('click', () => {
  if (game && network) {
    game.start(network.signaling.peerId);
  }
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const shareUrl = document.getElementById('share-url');
  shareUrl.select();
  document.execCommand('copy');
  alert('Link copied to clipboard!');
});

// Auto-fill room from URL
window.addEventListener('load', () => {
  const roomId = new URLSearchParams(location.search).get('room');
  if (roomId) {
    document.getElementById('room-input').value = roomId;
  }
});
