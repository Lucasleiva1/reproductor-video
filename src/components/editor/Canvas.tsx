"use client";

import { useRef, useEffect, useCallback } from "react";
import { useTimeline } from "@/hooks/useTimeline";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Upload, MousePointerSquareDashed, Maximize, Minimize, Volume2, VolumeX, Lock, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";

const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

export default function Canvas() {
  const { t } = useTranslation();
  const { videoUrl, zoom, posX, posY, playing, setPlaying, currentTime, setCurrentTime, setDuration, duration, setVideoFile, resolution, canvasScale, setCanvasScale } = useTimeline();
  const playerRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [fsIdle, setFsIdle] = useState(false);
  const [fsFreeMode, setFsFreeMode] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!canvasContainerRef.current) return;
    if (!document.fullscreenElement) {
      canvasContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) {
        setFsIdle(false);
        setFsFreeMode(false);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Fullscreen idle timer: hide controls after 4s of no mouse movement
  const resetIdleTimer = useCallback(() => {
    setFsIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setFsIdle(true), 4000);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    // Start the timer when entering fullscreen
    resetIdleTimer();

    const onMove = () => resetIdleTimer();
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isFullscreen, resetIdleTimer]);

  // Controls visibility: show on hover OR in fullscreen when not idle
  const showControls = isFullscreen ? !fsIdle : isHovering;
  
  // Keep external scrubs synchronized
  useEffect(() => {
    if (playerRef.current && Math.abs(playerRef.current.getCurrentTime() - currentTime) > 0.5) {
      playerRef.current.seekTo(currentTime, "seconds");
    }
  }, [currentTime]);

  const scale = zoom / 100;
  const translateX = (posX - 50) * -1;
  const translateY = (posY - 50) * -1;

  // In fullscreen fixed mode: ignore transforms, video fills screen
  const isFixedMode = isFullscreen && !fsFreeMode;
  const effectiveScale = isFixedMode ? 1 : scale;
  const effectiveTranslateX = isFixedMode ? 0 : translateX;
  const effectiveTranslateY = isFixedMode ? 0 : translateY;
  const effectiveCanvasScale = isFixedMode ? 1 : canvasScale;

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
      ref={canvasContainerRef}
      className={`w-full h-full bg-[#121212] overflow-hidden relative backdrop-blur-none ${isFixedMode ? 'p-0' : 'p-4 sm:p-8 lg:p-12'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onWheel={handleWheel}
      onDoubleClick={toggleFullscreen}
      onMouseMove={isFullscreen ? resetIdleTimer : undefined}
      style={{ cursor: isFullscreen && fsIdle ? 'none' : undefined }}
    >
      <div className="w-full h-full relative" style={{ containerType: 'size' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          {videoUrl ? (
          <div 
            className={`w-full h-full relative flex flex-col items-center justify-center ${isFixedMode ? 'p-0' : 'p-[2vmin]'}`}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            {/* The Actual "Screen" / Video Boundary */}
            <motion.div 
              className={`relative flex items-center justify-center overflow-hidden shrink-0 transition-shadow duration-300 ${isFixedMode ? 'bg-black' : 'rounded-[4px] bg-black ring-[1px] ring-white/10 shadow-2xl'}`}
              animate={{
                scale: effectiveCanvasScale
              }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              style={isFixedMode ? {
                width: '100%',
                height: '100%',
              } : {
                aspectRatio: `${resolution.w} / ${resolution.h}`,
                height: '100%',
                maxHeight: '100%',
                maxWidth: '100%',
              }}
            >
              <motion.div
                animate={{
                  scale: effectiveScale,
                  x: `${effectiveTranslateX}%`,
                  y: `${effectiveTranslateY}%`,
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
                  volume={volume}
                  muted={muted}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onDuration={(d: number) => setDuration(d)}
                  onProgress={(state: any) => {
                    if (playing) setCurrentTime(state.playedSeconds);
                  }}
                  progressInterval={100}
                  style={{ objectFit: isFixedMode ? 'contain' : 'contain' }}
                />
              </motion.div>
            </motion.div>

            {/* Fullscreen Mode Toggle: Fixed / Free (top-left, only in fullscreen) */}
            <AnimatePresence>
              {isFullscreen && showControls && (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  onClick={(e) => { e.stopPropagation(); setFsFreeMode(!fsFreeMode); }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="absolute top-3 left-3 z-50 flex items-center gap-2 bg-black/60 backdrop-blur-sm border border-white/10 rounded-md px-3 py-2 text-white/70 hover:text-white hover:bg-black/80 transition-all text-xs font-medium"
                >
                  {fsFreeMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span>{fsFreeMode ? 'Libre' : 'Fijo'}</span>
                </motion.button>
              )}
            </AnimatePresence>
            
            {/* Player Controls Overlay */}
            <AnimatePresence>
              {showControls && (
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

            {/* Bottom-right controls: Volume + Fullscreen */}
            <AnimatePresence>
              {showControls && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-3 right-3 z-50 flex items-center gap-2"
                >
                  {/* Volume Control */}
                  <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-white/10 rounded-md px-2 py-1.5 group"
                       onClick={(e) => e.stopPropagation()}
                       onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setMuted(!muted)}
                      className="text-white/70 hover:text-white transition-colors shrink-0"
                    >
                      {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setVolume(v);
                        if (v > 0 && muted) setMuted(false);
                      }}
                      className="w-20 h-1 accent-white appearance-none bg-white/20 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    />
                  </div>

                  {/* Fullscreen Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="w-9 h-9 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-white/70 hover:text-white hover:bg-black/80 flex items-center justify-center transition-all"
                    title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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
