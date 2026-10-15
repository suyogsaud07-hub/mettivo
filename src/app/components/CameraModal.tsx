'use client';

import { useRef, useState, useEffect } from 'react';

interface CameraModalProps {
  onCapture: (imageSrc: string) => void;
  onClose: () => void;
}

export default function CameraModal({ onCapture, onClose }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let currentStream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        // Request camera permission and start stream
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facingMode },
          audio: false,
        });
        
        currentStream = mediaStream;
        setStream(mediaStream);
        
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Camera access denied. Please check your browser permissions.");
      }
    };

    startCamera();

    // Cleanup: Stop camera when modal closes
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Mirror the image if using front camera
        if (facingMode === 'user') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64 and send back
        const imageSrc = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(imageSrc);
      }
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {error ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff', padding: '20px', textAlign: 'center' }}>
          {error}
          <button onClick={onClose} style={{ marginTop: '20px', padding: '10px 20px', borderRadius: '20px', border: 'none', cursor: 'pointer' }}>Close</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          </div>
          
          <div style={{ height: '120px', backgroundColor: '#0D0A10', display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: '20px' }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#F2E9E4', fontSize: '16px', cursor: 'pointer' }}>
              Cancel
            </button>
            
            <button 
              onClick={takePhoto}
              style={{ width: '70px', height: '70px', borderRadius: '50%', backgroundColor: '#D4B18A', border: '4px solid #29202D', cursor: 'pointer' }}
            />
            
            <button onClick={toggleCamera} style={{ background: 'none', border: 'none', color: '#F2E9E4', fontSize: '24px', cursor: 'pointer' }}>
              🔄
            </button>
          </div>
          
          {/* Hidden canvas to capture the image */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </>
      )}
    </div>
  );
}