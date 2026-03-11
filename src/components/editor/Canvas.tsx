"use client";

import { useRef, useEffect } from "react";
import { useTimeline } from "@/hooks/useTimeline";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Upload, MousePointerSquareDashed } from "lucide-react";
import { useTranslation } from "react-i18next";

const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

export default function Canvas() {
  const { t } = useTranslation();
  const { videoUrl, zoom, posX, posY, playing, setPlaying, currentTime, setCurrentTime, setDuration, duration, setVideoFile, resolution, canvasScale, setCanvasScale } = useTimeline();
  const playerRef = useRef<any>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Keep external scrubs synchronized
  useEffect(() => {
    if (playerRef.current && Math.abs(playerRef.current.getCurrentTime() - currentTime) > 0.5) {
      playerRef.current.seekTo(currentTime, "seconds");
    }
  }, [currentTime]);

  const scale = zoom / 100; // 0.1x to 5.0x
  const translateX = (posX - 50) * -1; // -50 to 50%
  const translateY = (posY - 50) * -1; // -50 to 50%

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setVideoFile(file, url);
    }
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setVideoFile(file, url);
    }
  };

  const skipTime = (amount: number) => {
    const newTime = Math.max(0, Math.min(currentTime + amount, duration));
    setCurrentTime(newTime);
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Prevent zooming the actual browser window
    if (e.ctrlKey || e.metaKey) {
       e.preventDefault();
    }
    
    // Scale up or down
    const delta = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(0.1, canvasScale + delta), 3.0);
    setCanvasScale(newScale);
  };

  return (
    <div 
      className="w-full h-full bg-[#121212] overflow-hidden relative backdrop-blur-none p-4 sm:p-8 lg:p-12"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onWheel={handleWheel}
    >
      <div className="w-full h-full relative" style={{ containerType: 'size' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          {videoUrl ? (
          <div 
            className="w-full h-full relative flex flex-col items-center justify-center p-[2vmin]"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            {/* The Actual "Screen" / Video Boundary */}
            <motion.div 
              className="relative flex items-center justify-center overflow-hidden rounded-[4px] bg-black ring-[1px] ring-white/10 shadow-2xl shrink-0 transition-shadow duration-300"
              animate={{
                scale: canvasScale
              }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              style={{
                aspectRatio: `${resolution.w} / ${resolution.h}`,
                height: '100%',
                maxHeight: '100%',
                maxWidth: '100%',
              }}
            >
              <motion.div
                animate={{
                  scale,
                  x: `${translateX}%`,
                  y: `${translateY}%`,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="w-full h-full flex items-center justify-center origin-center"
              >
                <ReactPlayer
                  ref={playerRef}
                  url={videoUrl}
                  width="100%"
                  height="100%"
                  playing={playing}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onDuration={(d: number) => setDuration(d)}
                  onProgress={(state: any) => {
                    if (playing) setCurrentTime(state.playedSeconds);
                  }}
                  progressInterval={100}
                  style={{ objectFit: 'contain' }}
                />
              </motion.div>
            </motion.div>
            
            {/* Player Controls Overlay */}
            <AnimatePresence>
              {isHovering && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute bottom-6 bg-background/80 backdrop-blur-md border border-border/50 text-foreground px-6 py-3 rounded-full flex items-center gap-6 shadow-2xl z-50"
                >
                  <button onClick={() => skipTime(-5)} className="hover:text-blue-400 transition-colors" title="-5 Seconds">
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setPlaying(!playing)} 
                    className="bg-blue-600 hover:bg-blue-500 text-white w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg hover:shadow-blue-500/50"
                  >
                    {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
                  </button>
                  <button onClick={() => skipTime(5)} className="hover:text-blue-400 transition-colors" title="+5 Seconds">
                    <SkipForward className="w-5 h-5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-muted/20 hover:border-muted-foreground/50 hover:bg-muted/30'}`}>
            <label className="cursor-pointer flex flex-col items-center gap-4 p-12 text-center relative z-10 w-full h-full justify-center">
              <input type="file" className="hidden" accept="video/*" onChange={handleFileSelect} />
              <div className="w-20 h-20 rounded-full bg-background border border-border flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-300">
                {isDragging ? <MousePointerSquareDashed className="w-8 h-8 text-blue-500" /> : <Upload className="w-8 h-8 text-muted-foreground" />}
              </div>
              <div className="space-y-1">
                <p className="text-xl font-medium tracking-tight text-foreground">
                  {isDragging ? t('drop_here') : t('upload_media')}
                </p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {t('upload_desc')}
                </p>
              </div>
            </label>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
