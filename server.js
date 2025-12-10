// =======================
// server.js (AUTO IP DETECTION)
// =======================
// 10 video rendered update

const express = require("express");
const https = require("https");
const fs = require("fs");
const socketIO = require("socket.io");
const cors = require("cors");
const os = require("os");
const { getRoom, createRoom } = require("./mediasoup/roomManager");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================================
// AUTO-DETECT LOCAL IP ADDRESS
// ===============================================
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  
  // Look for WiFi or Ethernet IPv4 address
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (localhost) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost'; // Fallback
}

const LOCAL_IP = getLocalIPAddress();
console.log(`📍 Detected Local IP: ${LOCAL_IP}`);

// Export for use in roomManager
global.ANNOUNCED_IP = LOCAL_IP;

// ------------------------------
// HTTPS SERVER
// ------------------------------
const server = https.createServer(
  {
    key: fs.readFileSync("./key.pem"),
    cert: fs.readFileSync("./cert.pem"),
  },
  app
);

// ------------------------------
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ------------------------------
// CREATE MEDIASOUP WORKER
// ------------------------------
let worker;
(async () => {
  const mediasoup = require("mediasoup");

  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });

  console.log("✅ Mediasoup Worker started");
})();

// ------------------------------
// SOCKET LOGIC
// ------------------------------
io.on("connection", (socket) => {
  console.log("👤 User connected:", socket.id);

  // -----------------------------------
  // JOIN ROOM
  // -----------------------------------
  socket.on("joinRoom", async ({ roomId, name }, callback) => {
    let room = getRoom(roomId);
    const isHost = !room;

    if (!room) room = await createRoom(roomId, worker);

    const peer = room.addPeer(socket.id, name);
    peer.isHost = isHost;

    socket.join(roomId);

    console.log(`✅ ${name} joined room ${roomId} as ${isHost ? 'HOST' : 'PARTICIPANT'}`);

    callback({
      rtpCapabilities: room.router.rtpCapabilities,
      peers: room.getPeerList(),
      isHost,
    });

    socket.to(roomId).emit("newPeer", {
      id: peer.id,
      name: peer.name,
      isHost,
    });

    // Send ALL existing producers to new peer
    room.peers.forEach((p) => {
      if (p.id === socket.id) return;

      p.producers.forEach((prod) => {
        socket.emit("newProducer", {
          producerId: prod.id,
          peerId: p.id,
          kind: prod.kind,
        });
      });
    });
  });

  // -----------------------------------
  // CREATE SEND TRANSPORT
  // -----------------------------------
  socket.on("createSendTransport", async ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const transportParams = await room.createSendTransport(socket.id);
    callback(transportParams);
  });

  socket.on("connectSendTransport", async ({ roomId, dtlsParameters }) => {
    const room = getRoom(roomId);
    if (!room) return;
    await room.connectSendTransport(socket.id, dtlsParameters);
  });

  // -----------------------------------
  // PRODUCE
  // -----------------------------------
  socket.on("produce", async ({ roomId, kind, rtpParameters }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const producerId = await room.produce(socket.id, kind, rtpParameters);

    socket.to(roomId).emit("newProducer", {
      producerId,
      peerId: socket.id,
      kind,
    });

    callback({ id: producerId });
  });

  // -----------------------------------
  // CREATE RECV TRANSPORT
  // -----------------------------------
  socket.on("createRecvTransport", async ({ roomId }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const recvParams = await room.createRecvTransport(socket.id);
    callback(recvParams);
  });

  socket.on("connectRecvTransport", async ({ roomId, dtlsParameters }) => {
    const room = getRoom(roomId);
    if (!room) return;

    await room.connectRecvTransport(socket.id, dtlsParameters);
  });

  // -----------------------------------
  // CONSUME
  // -----------------------------------
  socket.on("consume", async ({ roomId, producerId, rtpCapabilities }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    try {
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: "Cannot consume" });
      }

      const consumer = await room.consume(socket.id, producerId, rtpCapabilities);

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error("❌ Consume error:", err);
      callback({ error: err.toString() });
    }
  });

  // -----------------------------------
  // RESUME CONSUMER
  // -----------------------------------
  socket.on("resumeConsumer", async ({ roomId, consumerId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    await room.resumeConsumer(socket.id, consumerId);
  });

  // -----------------------------------
  // DISCONNECT
  // -----------------------------------
  socket.on("disconnect", () => {
    console.log("👋 User disconnected:", socket.id);
  });
});

// ---------------------------------------
// START SERVER
// ---------------------------------------
server.listen(3001, "0.0.0.0", () => {
  console.log("\n🎉 ================================");
  console.log("   VIDEO CONFERENCE SERVER READY");
  console.log("   ================================");
  console.log(`\n📍 Local IP: ${LOCAL_IP}`);
  console.log(`\n🔗 Access from:`);
  console.log(`   • This computer:  https://localhost:5173`);
  console.log(`   • Same network:   https://${LOCAL_IP}:5173`);
  console.log(`   • Backend:        https://${LOCAL_IP}:3001`);
  console.log("\n⚠️  Accept certificate on BOTH ports (3001 & 5173)");
  console.log("================================\n");
});