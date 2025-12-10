import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

export let socket = null;

// ------------------------------------------------------
// CONNECT SOCKET (HTTPS + WSS)
// ------------------------------------------------------
export function connectSocket() {
  if (socket) return socket;

  const backend = `https://${window.location.hostname}:3001`;

  socket = io(backend, {
    transports: ["websocket", "polling"],
    secure: true,
    rejectUnauthorized: false,
  });

  socket.on("connect", () => {
    console.log("Connected to backend:", backend);
  });

  socket.on("connect_error", (err) => {
    console.error("Socket connection error:", err);
  });

  return socket;
}

// ------------------------------------------------------
let device = null;
let sendTransport = null;
let recvTransport = null;
export let localStream = null;

// CRITICAL FIX: Store peer streams properly
const peerStreams = new Map(); // peerId -> MediaStream

// ------------------------------------------------------
// JOIN ROOM
// ------------------------------------------------------
export async function joinRoom(roomId, name, onNewStream) {
  return new Promise((resolve) => {
    socket.emit("joinRoom", { roomId, name }, async (data) => {
      console.log("📥 Joined Room Response:", {
        isHost: data.isHost,
        peersCount: data.peers?.length || 0,
        peers: data.peers
      });

      if (!data || !data.rtpCapabilities) {
        console.error("Invalid room join response:", data);
        return;
      }

      // Load router rtpCaps
      await loadDevice(data.rtpCapabilities);

      // Create recv transport BEFORE consuming
      recvTransport = await createRecvTransport(roomId);
      console.log("✅ Recv transport created");

      resolve(data);

      // Consume all existing producers
      console.log("🔍 Checking existing peers for producers...");
      data.peers.forEach((p) => {
        console.log(`   Peer ${p.name} (${p.id}):`, {
          videoProducers: p.videoProducers?.length || 0,
          audioProducers: p.audioProducers?.length || 0
        });

        // Initialize stream for this peer
        if (!peerStreams.has(p.id)) {
          peerStreams.set(p.id, new MediaStream());
          console.log(`   Created MediaStream for peer ${p.id}`);
        }

        const allProducers = [
          ...(p.videoProducers || []),
          ...(p.audioProducers || [])
        ];

        if (allProducers.length > 0) {
          console.log(`   📡 Consuming ${allProducers.length} producers from ${p.name}`);
          allProducers.forEach((prodId) => {
            consumeStream(roomId, prodId, p.id, onNewStream);
          });
        } else {
          console.log(`   ⚠️ No producers yet from ${p.name}`);
        }
      });

      // Listen for new producers
      socket.on("newProducer", ({ producerId, peerId, kind }) => {
        console.log(`🆕 New producer from peer ${peerId}:`, { producerId, kind });
        
        if (!peerStreams.has(peerId)) {
          peerStreams.set(peerId, new MediaStream());
          console.log(`   Created MediaStream for new peer ${peerId}`);
        }
        
        consumeStream(roomId, producerId, peerId, onNewStream);
      });
    });
  });
}

// ------------------------------------------------------
// LOAD DEVICE
// ------------------------------------------------------
async function loadDevice(rtpCapabilities) {
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
}

// ------------------------------------------------------
// START PRODUCING (VIDEO + AUDIO)
// ------------------------------------------------------
export async function startProducing(stream, roomId) {
  localStream = stream;

  sendTransport = await createSendTransport(roomId);

  if (!sendTransport) {
    console.error("SendTransport creation failed");
    return;
  }

  // Produce video
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    await sendTransport.produce({ track: videoTrack });
  }

  // Produce audio
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    await sendTransport.produce({ track: audioTrack });
  }
}

// ------------------------------------------------------
// SEND TRANSPORT
// ------------------------------------------------------
function createSendTransport(roomId) {
  return new Promise((resolve) => {
    socket.emit("createSendTransport", { roomId }, (params) => {
      console.log("SEND TRANSPORT PARAMS:", params);

      if (!params) {
        console.error("SendTransport Error: No params received");
        return resolve(null);
      }

      const transport = device.createSendTransport(params);

      transport.on("connect", ({ dtlsParameters }, cb) => {
        socket.emit("connectSendTransport", { roomId, dtlsParameters });
        cb();
      });

      transport.on("produce", ({ kind, rtpParameters }, cb) => {
        socket.emit(
          "produce",
          { roomId, kind, rtpParameters },
          ({ id }) => cb({ id })
        );
      });

      resolve(transport);
    });
  });
}

// ------------------------------------------------------
// RECV TRANSPORT
// ------------------------------------------------------
function createRecvTransport(roomId) {
  return new Promise((resolve) => {
    socket.emit("createRecvTransport", { roomId }, (params) => {
      if (!params) {
        console.error("RecvTransport Error: No params received");
        return resolve(null);
      }

      const transport = device.createRecvTransport(params);

      transport.on("connect", ({ dtlsParameters }, cb) => {
        socket.emit("connectRecvTransport", { roomId, dtlsParameters });
        cb();
      });

      resolve(transport);
    });
  });
}

// ------------------------------------------------------
// CONSUME STREAM - CRITICAL FIX
// ------------------------------------------------------
async function consumeStream(roomId, producerId, peerId, onNewStream) {
  if (!producerId) {
    console.error("❌ Consume Error: producerId missing");
    return;
  }

  console.log(`📡 Consuming producer ${producerId} from peer ${peerId}`);

  socket.emit(
    "consume",
    {
      roomId,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    },
    async (res) => {
      if (res.error) {
        console.error("❌ Consume Error:", res.error);
        return;
      }

      console.log(`✅ Consume response for ${producerId}:`, {
        consumerId: res.id,
        kind: res.kind
      });

      const consumer = await recvTransport.consume({
        id: res.id,
        producerId: res.producerId,
        kind: res.kind,
        rtpParameters: res.rtpParameters,
      });

      // Get or create peer stream
      let peerStream = peerStreams.get(peerId);
      if (!peerStream) {
        peerStream = new MediaStream();
        peerStreams.set(peerId, peerStream);
        console.log(`   Created new MediaStream for ${peerId}`);
      }
      
      // Add track
      peerStream.addTrack(consumer.track);
      
      console.log(`🎥 Added ${res.kind} track for peer ${peerId}:`, {
        totalTracks: peerStream.getTracks().length,
        videoTracks: peerStream.getVideoTracks().length,
        audioTracks: peerStream.getAudioTracks().length
      });

      // Notify with the current stream state
      onNewStream(peerId, peerStream);

      socket.emit("resumeConsumer", {
        roomId,
        consumerId: consumer.id,
      });

      console.log(`✅ Consumer ${consumer.id} resumed`);
    }
  );
}