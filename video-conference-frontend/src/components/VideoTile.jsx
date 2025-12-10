import React, { useEffect, useRef } from "react";

export default function VideoTile({ peerId, name, stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;

    if (!hasValidStream) {
      videoElement.srcObject = null;
      return;
    }

    // Set srcObject
    videoElement.srcObject = stream;

    // Force play immediately
    const playVideo = () => {
      videoElement.play().catch(() => {
        // If autoplay fails, try again on next user interaction
        const playOnClick = () => {
          videoElement.play();
          document.removeEventListener('click', playOnClick);
        };
        document.addEventListener('click', playOnClick, { once: true });
      });
    };

    playVideo();

    // Listen for new tracks
    const handleAddTrack = () => {
      playVideo();
    };

    stream.addEventListener('addtrack', handleAddTrack);

    // Cleanup
    return () => {
      stream.removeEventListener('addtrack', handleAddTrack);
      if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };
  }, [stream, peerId]);

  const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;
  const hasVideo = hasValidStream && stream.getVideoTracks().length > 0;

  return (
    <div className="relative rounded-xl overflow-hidden bg-gray-800 aspect-video">
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={peerId === "local"}
        className="w-full h-full object-cover"
      />

      {/* Loading State */}
      {!hasValidStream && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl font-bold text-white">
                {name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <div className="w-8 h-8 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
            <p className="text-gray-400 text-sm">Connecting...</p>
          </div>
        </div>
      )}

      {/* Name Label */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 text-sm bg-black/70 text-white rounded-lg font-medium shadow-lg">
        {name || "User"}
      </div>
    </div>
  );
}