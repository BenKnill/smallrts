// server.js - Signaling relay for WebRTC game
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

server.listen(8443, () => console.log('Server running at https://<host-ip>:8443'));
