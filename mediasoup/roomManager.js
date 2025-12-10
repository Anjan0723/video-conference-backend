const mediasoup = require("mediasoup");

const rooms = new Map();

// ============================================
// AUTO-DETECT IP - Set by server.js
// ============================================
function getAnnouncedIP() {
  // Use IP set by server.js, or fallback to null for auto-detection
  return global.ANNOUNCED_IP || null;
}

async function createRoom(roomId, worker) {
  const mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: { "x-google-start-bitrate": 1500 },
    },
  ];

  const router = await worker.createRouter({ mediaCodecs });

  const room = {
    id: roomId,
    router,
    peers: new Map(),

    addPeer(id, name) {
      const peer = {
        id,
        name,
        isHost: false,
        sendTransport: null,
        recvTransport: null,
        producers: [],
        consumers: [],
      };

      this.peers.set(id, peer);
      return peer;
    },

    getPeerList() {
      return [...this.peers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,

        videoProducers: p.producers
          .filter((prod) => prod.kind === "video")
          .map((prod) => prod.id),

        audioProducers: p.producers
          .filter((prod) => prod.kind === "audio")
          .map((prod) => prod.id),
      }));
    },

    async createSendTransport(peerId) {
      const announcedIp = getAnnouncedIP();
      
      const transport = await this.router.createWebRtcTransport({
        listenIps: [{ 
          ip: "0.0.0.0", 
          announcedIp: announcedIp  // Auto-detected IP
        }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      this.peers.get(peerId).sendTransport = transport;

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    },

    async connectSendTransport(peerId, dtlsParameters) {
      await this.peers.get(peerId).sendTransport.connect({ dtlsParameters });
    },

    async produce(peerId, kind, rtpParameters) {
      const peer = this.peers.get(peerId);

      const producer = await peer.sendTransport.produce({
        kind,
        rtpParameters,
      });

      peer.producers.push({ id: producer.id, kind });

      return producer.id;
    },

    async createRecvTransport(peerId) {
      const announcedIp = getAnnouncedIP();
      
      const transport = await this.router.createWebRtcTransport({
        listenIps: [{ 
          ip: "0.0.0.0", 
          announcedIp: announcedIp  // Auto-detected IP
        }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      this.peers.get(peerId).recvTransport = transport;

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    },

    async connectRecvTransport(peerId, dtlsParameters) {
      await this.peers.get(peerId).recvTransport.connect({ dtlsParameters });
    },

    async consume(peerId, producerId, rtpCapabilities) {
      const peer = this.peers.get(peerId);

      const consumer = await peer.recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.push(consumer);
      return consumer;
    },

    async resumeConsumer(peerId, consumerId) {
      const peer = this.peers.get(peerId);
      const consumer = peer.consumers.find((c) => c.id === consumerId);

      if (consumer) await consumer.resume();
    },
  };

  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

module.exports = { createRoom, getRoom };