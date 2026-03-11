"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { motion } from "framer-motion";
import { useState, useRef } from "react";
import { FaPlay, FaPause } from "react-icons/fa";
import { useTranslation } from "react-i18next";

export default function Timeline() {
  const { t } = useTranslation();
  const { duration, currentTime, startTime, endTime, setStartTime, setEndTime, zoom, videoUrl, videoFile, playing, setPlaying, setCurrentTime } = useTimeline();
  const [timelineZoom, setTimelineZoom] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });

  if (!videoUrl) return null;

  const handleScrub = (e: React.MouseEvent | React.PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newTime = (x / rect.width) * duration;
    setCurrentTime(newTime);
  };

  const handleTrimChange = (value: number | readonly number[]) => {
    if (Array.isArray(value) || (value as readonly number[]).length !== undefined) {
      const arr = value as readonly number[];
      setStartTime(arr[0]);
      setEndTime(arr[1]);
    }
  };

  const progressPercent = (currentTime / duration) * 100;

  const togglePlay = () => {
    setPlaying(!playing);
  };

  const handleScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) { // Middle mouse button
      dragRef.current = {
        isDragging: true,
        startX: e.pageX - (scrollContainerRef.current?.offsetLeft || 0),
        scrollLeft: scrollContainerRef.current?.scrollLeft || 0,
      };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch(err) {}
    }
  };

  const handleScrollPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging || !scrollContainerRef.current) return;
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - dragRef.current.startX);
    scrollContainerRef.current.scrollLeft = dragRef.current.scrollLeft - walk;
  };

  const handleScrollPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err) {}
    }
  };

  return (
    <div className="flex-1 flex w-full relative bg-background/95 backdrop-blur-sm p-6 flex-col gap-6 overflow-hidden">
      <div className="flex justify-between items-center text-xs text-muted-foreground w-full">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-lg text-foreground tracking-tight flex items-center gap-4">
             {videoFile?.name || t('timeline_title')}
             <button onClick={togglePlay} className="flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-full w-8 h-8 transition-all">
                {playing ? <FaPause className="w-3 h-3" /> : <FaPlay className="w-3 h-3 translate-x-0.5" />}
             </button>
          </span>
          <span>{t('timeline_desc')}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{t('zoom')} ({timelineZoom}x)</span>
          <div className="w-32">
            <Slider value={[timelineZoom]} min={1} max={10} step={0.1} onValueChange={(val) => setTimelineZoom(Array.isArray(val) ? val[0] : val as number)} />
          </div>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative rounded-md border border-border bg-muted/50 items-center px-4"
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerUp}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      >
        <motion.div 
          ref={trackRef as any}
          className="h-full relative flex items-center shrink-0 min-w-full origin-left"
          animate={{ width: `${timelineZoom * 100}%` }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        >
          {/* Scrubbing Ruler Area */}
          <div 
            className="absolute top-0 left-0 right-0 h-10 cursor-col-resize z-40 hover:bg-white/5 transition-colors border-b border-border/50"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              handleScrub(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) handleScrub(e);
            }}
          >
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => {
               if (i > duration) return null;
               
               const pxPerSec = (timelineZoom * 1000) / duration;
               let majorStep = 1;
               if (pxPerSec < 4) majorStep = 60;
               else if (pxPerSec < 10) majorStep = 30;
               else if (pxPerSec < 20) majorStep = 10;
               else if (pxPerSec < 40) majorStep = 5;

               const isMajor = i % majorStep === 0;
               const showMinor = pxPerSec > 3;

               if (!isMajor && !showMinor) return null;

               return (
                 <div 
                   key={i} 
                   className="absolute bottom-0 flex flex-col items-center -translate-x-1/2 pointer-events-none"
                   style={{ left: `${(i / Math.max(duration, 0.1)) * 100}%` }}
                 >
                   {isMajor ? (
                     <>
                       <span className="text-[10px] text-muted-foreground font-mono select-none leading-none mb-1">
                         {i >= 60 ? `${Math.floor(i / 60)}:${(i % 60).toString().padStart(2, '0')}` : `${i}s`}
                       </span>
                       <div className="w-px h-2 bg-muted-foreground/60"></div>
                     </>
                   ) : (
                     <div className="w-px h-1 bg-muted-foreground/30"></div>
                   )}
                 </div>
               );
            })}
          </div>

          {/* Progress Head line */}
          <div 
            className="absolute top-0 bottom-0 w-px bg-red-500 z-30 pointer-events-none"
            style={{ left: `${progressPercent}%` }}
          >
            <div className="absolute top-0 -translate-x-1/2 w-4 h-4 rounded-sm shadow-md bg-red-500 transform rotate-45" />
          </div>

          {/* Video track visualization area */}
          <div className="w-full h-16 bg-blue-500/20 border border-blue-500/40 rounded-sm relative flex items-center justify-center">

            {/* Trimming slider overlaying the track */}
            <div className="absolute inset-0 pointer-events-auto flex items-center px-0">
               <Slider 
                 value={[startTime, endTime > 0 ? endTime : duration]} 
                 min={0} 
                 max={duration} 
                 step={0.1} 
                 onValueChange={handleTrimChange}
                 className="z-10"
               />
            </div>
            {/* Dark overlay for trimmed out sections */}
            <div className="absolute left-0 top-0 bottom-0 bg-black/60 z-0 pointer-events-none" style={{ right: `${100 - (startTime / duration) * 100}%` }} />
            <div className="absolute right-0 top-0 bottom-0 bg-black/60 z-0 pointer-events-none" style={{ left: `${(endTime / duration) * 100}%` }} />
          </div>

        </motion.div>
      </div>

      <div className="flex justify-between text-xs font-mono text-muted-foreground">
        <span>{startTime.toFixed(2)}s</span>
        <span>{endTime.toFixed(2)}s</span>
      </div>
    </div>
  );
}
