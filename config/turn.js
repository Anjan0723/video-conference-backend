module.exports = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "YOUR_METERED_USERNAME",
      credential: "YOUR_METERED_PASSWORD"
    }
  ]
};
