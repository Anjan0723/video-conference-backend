import React, { useState, useEffect, useRef } from "react";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Users, Copy, Check } from "lucide-react";

import VideoTile from "./components/VideoTile";
import { connectSocket, joinRoom, startProducing, socket } from "./webrtc";

export default function App() {
  const [currentView, setCurrentView] = useState("home");
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");

  const [participants, setParticipants] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [copied, setCopied] = useState(false);

  const localStreamRef = useRef(null);
  const isHostRef = useRef(false);

  // Debug: Log participants state changes
  useEffect(() => {
    console.log("👥 PARTICIPANTS STATE UPDATED:", participants.map(p => ({
      id: p.id,
      name: p.name,
      hasStream: !!p.stream,
      streamTracks: p.stream?.getTracks?.()?.length || 0
    })));
  }, [participants]);

  useEffect(() => {
    connectSocket();

    // Listen for new peers joining
    socket?.on("newPeer", ({ id, name, isHost }) => {
      console.log("👤 New peer joined:", name, id);
      setParticipants((prev) => {
        // Check if already exists
        if (prev.find(p => p.id === id)) return prev;
        
        return [...prev, {
          id,
          name,
          isHost,
          stream: null,
          streamKey: Date.now()
        }];
      });
    });

    return () => {
      socket?.off("newPeer");
    };
  }, []);

  const startLocalPreview = async () => {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      return stream;
    } catch {
      alert("Camera/Mic permission denied");
      return null;
    }
  };

  const createRoom = async () => {
    const newRoomId = Math.random().toString(36).substring(2, 9).toUpperCase();
    setRoomId(newRoomId);
    
    // Start preview immediately
    await startLocalPreview();
    
    setCurrentView("lobby");
  };

  const goToLobby = async () => {
    if (!roomId.trim()) return alert("Enter Meeting ID");
    
    // Start preview immediately
    await startLocalPreview();
    
    setCurrentView("lobby");
  };

  // ------------------------------
  // ENTER ROOM — FIXED
  // ------------------------------
  const enterRoom = async () => {
    if (!userName.trim()) return alert("Enter your name");

    const previewStream = await startLocalPreview();
    if (!previewStream) return;

    console.log("🚀 Entering room...");

    const { peers, isHost } = await joinRoom(roomId, userName, (peerId, stream) => {
      console.log("📺 STREAM UPDATE CALLBACK:", {
        peerId,
        streamId: stream.id,
        tracks: stream.getTracks().length,
        video: stream.getVideoTracks().length,
        audio: stream.getAudioTracks().length
      });
      
      // Force update with new stream reference
      setParticipants((prevParticipants) => {
        console.log("   Current participants before update:", prevParticipants.map(p => p.id));
        
        const participantExists = prevParticipants.some(p => p.id === peerId);
        
        if (participantExists) {
          // Update existing participant
          console.log("   ✅ Updating stream for existing participant:", peerId);
          return prevParticipants.map((p) => 
            p.id === peerId 
              ? { ...p, stream, streamKey: Date.now() } 
              : p
          );
        } else {
          // Add new participant (late joiner)
          console.log("   ✅ Adding NEW participant:", peerId);
          return [...prevParticipants, { 
            id: peerId, 
            name: "Remote User", 
            isHost: false, 
            stream,
            streamKey: Date.now()
          }];
        }
      });
    });

    console.log("✅ Room joined. IsHost:", isHost, "Peers:", peers);
    isHostRef.current = isHost;

    // Initialize participants list BEFORE producing
    const initialParticipants = peers
      .filter((p) => p.id !== socket.id)
      .map((p) => {
        console.log("📋 Initial peer:", p);
        return {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          stream: null,
          streamKey: Date.now()
        };
      });

    console.log("📋 Setting initial participants:", initialParticipants);
    setParticipants(initialParticipants);

    // CRITICAL: Wait a bit before producing to ensure participants are set
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start producing
    console.log("🎬 Starting to produce streams...");
    await startProducing(previewStream, roomId);

    setCurrentView("room");
  };

  const toggleAudio = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsAudioEnabled(track.enabled);
    }
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoEnabled(track.enabled);
    }
  };

  const leaveRoom = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setParticipants([]);
    setRoomId("");
    setUserName("");
    setCurrentView("home");
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // ------------------------------
  // HOME SCREEN
  // ------------------------------
  if (currentView === "home") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-3xl w-full max-w-md">
          <button
            onClick={createRoom}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl mb-4 text-lg"
          >
            Create Meeting
          </button>

          <input
            className="w-full p-3 bg-gray-700 text-white rounded-xl mb-4 text-center"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="Enter Meeting ID"
          />

          <button
            onClick={goToLobby}
            className="w-full bg-gray-600 text-white py-3 rounded-xl"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------
  // LOBBY
  // ------------------------------
  if (currentView === "lobby") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-3xl w-full max-w-lg">
          <VideoTile peerId="local" name="You" stream={localStreamRef.current} />

          <input
            className="w-full p-3 bg-gray-700 text-white rounded-xl my-4"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
          />

          <div className="flex justify-between bg-gray-700 p-4 rounded-xl mb-4 text-white">
            <div>
              <div className="text-sm text-gray-400">Meeting ID</div>
              <div className="text-xl font-bold">{roomId}</div>
            </div>
            <button onClick={copyRoomId}>
              {copied ? <Check className="text-green-400" /> : <Copy />}
            </button>
          </div>

          <button
            onClick={enterRoom}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl mt-2"
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------
  // ROOM SCREEN
  // ------------------------------
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="p-4 bg-gray-800 flex justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          Live • Meeting ID: {roomId}
        </div>

        <div className="flex items-center gap-1 text-gray-400">
          <Users size={16} /> {participants.length + 1}
        </div>
      </div>

      <div
        className="grid gap-4 p-4 flex-1"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
      >
        <VideoTile
          peerId="local"
          name={`${userName}${isHostRef.current ? " (Host)" : ""}`}
          stream={localStreamRef.current}
        />

        {participants.map((p) => (
          <VideoTile
            key={`${p.id}-${p.streamKey || 0}`}
            peerId={p.id}
            name={`${p.name}${p.isHost ? " (Host)" : ""}`}
            stream={p.stream}
          />
        ))}
      </div>

      <div className="p-4 bg-gray-800 flex justify-center gap-4">
        <button onClick={toggleAudio} className="p-3 bg-gray-700 rounded-xl">
          {isAudioEnabled ? <Mic /> : <MicOff className="text-red-500" />}
        </button>

        <button onClick={toggleVideo} className="p-3 bg-gray-700 rounded-xl">
          {isVideoEnabled ? <Video /> : <VideoOff className="text-red-500" />}
        </button>

        <button onClick={leaveRoom} className="p-3 bg-red-600 rounded-xl">
          <PhoneOff />
        </button>
      </div>
    </div>
  );
}