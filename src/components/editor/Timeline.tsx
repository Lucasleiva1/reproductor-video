"use client";

import { useTimeline } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { motion } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";
import { FaPlay, FaPause } from "react-icons/fa";
import { Trash2, Magnet } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// --- CONFIGURACIÓN TÉCNICA ---
const SNAP_THRESHOLD_PX = 10; // Píxeles para activar el "imán" magnético

// Colores para los clips alternados
const CLIP_COLORS = [
  { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.5)',  solid: '#6366f1', handle: 'rgba(99,102,241,0.6)' },
  { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.5)',  solid: '#10b981', handle: 'rgba(16,185,129,0.6)' },
  { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.5)',  solid: '#f59e0b', handle: 'rgba(245,158,11,0.6)' },
  { bg: 'rgba(236,72,153,0.15)',  border: 'rgba(236,72,153,0.5)',  solid: '#ec4899', handle: 'rgba(236,72,153,0.6)' },
  { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.5)',  solid: '#3b82f6', handle: 'rgba(59,130,246,0.6)' },
  { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.5)',  solid: '#a855f7', handle: 'rgba(168,85,247,0.6)' },
];

export default function Timeline() {
  const { t } = useTranslation();
  const { duration, currentTime, clips, splitClip, removeClip, zoom, videoUrl, videoFile, playing, setPlaying, setCurrentTime } = useTimeline();
  const [timelineZoom, setTimelineZoom] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
  const [bladeMode, setBladeMode] = useState(false);
  const [snappingActive, setSnappingActive] = useState(true);

  // Clip Dragging State
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [isSnapped, setIsSnapped] = useState(false);
  const clipDragRef = useRef<{ id: string | null; startX: number; initialStartAt: number }>({
    id: null,
    startX: 0,
    initialStartAt: 0,
  });

  // Dynamic PX_PER_SEC: calculates how many pixels represent 1 second based on current zoom and track width
  const getTrackWidth = useCallback(() => {
    return trackRef.current?.getBoundingClientRect().width || 1;
  }, []);

  const getPxPerSec = useCallback(() => {
    if (duration <= 0) return 1;
    return getTrackWidth() / duration;
  }, [duration, getTrackWidth]);

  // Convert pixel threshold to seconds dynamically
  const getSnapThresholdSec = useCallback(() => {
    const pxPerSec = getPxPerSec();
    return pxPerSec > 0 ? SNAP_THRESHOLD_PX / pxPerSec : 0.5;
  }, [getPxPerSec]);

  const handleClipPointerDown = (e: React.PointerEvent, clipId: string, currentStartAt: number) => {
    if (bladeMode) return;
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    clipDragRef.current = {
      id: clipId,
      startX: e.clientX,
      initialStartAt: currentStartAt,
    };
    setDraggingClipId(clipId);
  };

  const handleClipPointerMove = useCallback((e: React.PointerEvent) => {
    if (!clipDragRef.current.id || !trackRef.current) return;
    
    const rect = trackRef.current.getBoundingClientRect();
    const pxDelta = e.clientX - clipDragRef.current.startX;
    const timeDelta = (pxDelta / rect.width) * duration;
    
    let newStartAt = clipDragRef.current.initialStartAt + timeDelta;
    newStartAt = Math.max(0, newStartAt);

    let snapped = false;

    if (snappingActive) {
      const snapThreshold = getSnapThresholdSec();
      const activeClip = clips.find(c => c.id === clipDragRef.current.id);
      if (!activeClip) return;

      const thisDuration = activeClip.trimEnd - activeClip.trimStart;
      const thisEnd = newStartAt + thisDuration;
      const otherClips = clips.filter(c => c.id !== clipDragRef.current.id);

      for (const other of otherClips) {
        const otherEnd = other.startAt + (other.trimEnd - other.trimStart);
        const otherStart = other.startAt;

        // Snap al INICIO de este clip con el FINAL de otro clip
        if (Math.abs(newStartAt - otherEnd) < snapThreshold) {
          newStartAt = otherEnd;
          snapped = true;
          break;
        }
        // Snap al FINAL de este clip con el INICIO de otro clip
        if (Math.abs(thisEnd - otherStart) < snapThreshold) {
          newStartAt = otherStart - thisDuration;
          snapped = true;
          break;
        }
        // Snap al INICIO de este clip con el INICIO de otro clip
        if (Math.abs(newStartAt - otherStart) < snapThreshold) {
          newStartAt = otherStart;
          snapped = true;
          break;
        }
        // Snap al FINAL de este clip con el FINAL de otro clip
        if (Math.abs(thisEnd - otherEnd) < snapThreshold) {
          newStartAt = otherEnd - thisDuration;
          snapped = true;
          break;
        }
      }

      // Snap al inicio del timeline (0)
      if (!snapped && Math.abs(newStartAt) < snapThreshold) {
        newStartAt = 0;
        snapped = true;
      }
    }

    setIsSnapped(snapped);
    newStartAt = Math.max(0, newStartAt);
    useTimeline.getState().updateClip(clipDragRef.current.id, { startAt: newStartAt });
  }, [clips, duration, snappingActive, getSnapThresholdSec]);

  const handleClipPointerUp = useCallback((e: React.PointerEvent) => {
    if (clipDragRef.current.id) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      clipDragRef.current.id = null;
      setDraggingClipId(null);
      setIsSnapped(false);
    }
  }, []);

  const handleScrub = (e: React.MouseEvent | React.PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const newTime = (x / rect.width) * duration;
    setCurrentTime(newTime);
  };

  const handleTrackClick = (e: React.MouseEvent, clipId: string) => {
    if (!bladeMode) return;
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const clickTime = (x / rect.width) * duration;
    splitClip(clipId, clickTime);
    setBladeMode(false);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const togglePlay = () => setPlaying(!playing);

  // Middle-mouse scrolling for timeline panning
  const handleScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      dragRef.current = {
        isDragging: true,
        startX: e.pageX - (scrollContainerRef.current?.offsetLeft || 0),
        scrollLeft: scrollContainerRef.current?.scrollLeft || 0,
      };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
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
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  // Format time to readable string
  const formatTime = (secs: number) => {
    if (secs >= 60) return `${Math.floor(secs / 60)}:${(Math.floor(secs) % 60).toString().padStart(2, '0')}`;
    return `${secs.toFixed(1)}s`;
  };

  return (
    <div className="flex-1 flex w-full relative bg-[#0c0c0e]/95 backdrop-blur-sm p-6 flex-col gap-4 overflow-hidden">
      {/* Header Row */}
      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-lg text-white tracking-tight flex items-center gap-3">
             {videoFile?.name || t('timeline_title')}
             
             {/* Play/Pause */}
             <button onClick={togglePlay} className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full w-9 h-9 transition-all shadow-lg shadow-indigo-500/20">
                {playing ? <FaPause className="w-3 h-3" /> : <FaPlay className="w-3 h-3 translate-x-0.5" />}
             </button>

             {/* Blade Tool */}
             <button 
               onClick={() => setBladeMode(!bladeMode)} 
               title={bladeMode ? 'Cortando...' : 'Blade Tool'}
               className={`p-2 rounded-lg transition-all flex items-center justify-center ${bladeMode ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 scale-110' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
             >
               <span className="text-base leading-none">✂️</span>
             </button>

             {/* Snapping Toggle */}
             <button 
               onClick={() => setSnappingActive(!snappingActive)} 
               title={snappingActive ? 'Snapping Activo (10px)' : 'Snapping Desactivado'}
               className={`p-2 rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs font-medium ${snappingActive ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
             >
               <Magnet className="w-3.5 h-3.5" />
             </button>
          </span>
          <span className="text-zinc-500 text-xs">{t('timeline_desc')}</span>
        </div>
        <div className="flex items-center gap-3 mr-12">
          <span className="text-zinc-500 text-xs">{t('zoom')} ({timelineZoom.toFixed(1)}x)</span>
          <div className="w-24">
            <Slider value={[timelineZoom]} min={1} max={10} step={0.1} onValueChange={(val) => setTimelineZoom(Array.isArray(val) ? val[0] : val as number)} />
          </div>
        </div>
      </div>

      {/* Timeline Rail */}
      <div 
        ref={scrollContainerRef}
        className={`flex-1 overflow-x-auto overflow-y-hidden relative rounded-xl border border-zinc-800/50 bg-zinc-900/30 ${bladeMode ? 'cursor-crosshair' : ''}`}
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.3) inset' }}
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerUp}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      >
        <motion.div 
          ref={trackRef}
          className="h-full relative flex items-center shrink-0 min-w-full origin-left"
          animate={{ width: `${timelineZoom * 100}%` }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        >
          {/* Background Grid Lines */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {duration > 0 && Array.from({ length: Math.min(Math.ceil(duration / (timelineZoom > 5 ? 1 : timelineZoom > 2 ? 5 : 10)) + 1, 200) }).map((_, i) => {
              const step = timelineZoom > 5 ? 1 : timelineZoom > 2 ? 5 : 10;
              const sec = i * step;
              if (sec > duration) return null;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-px bg-white/[0.03]"
                  style={{ left: `${(sec / duration) * 100}%` }}
                />
              );
            })}
          </div>

          {/* Scrubbing Ruler Area */}
          <div 
            className="absolute top-0 left-0 right-0 h-8 z-40 hover:bg-white/[0.02] transition-colors border-b border-zinc-800/50"
            style={{ cursor: bladeMode ? 'crosshair' : 'col-resize' }}
            onPointerDown={(e) => {
              if (bladeMode) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              handleScrub(e);
            }}
            onPointerMove={(e) => {
              if (bladeMode) return;
              if (e.buttons === 1) handleScrub(e);
            }}
          >
            {duration > 0 && Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => {
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
                       <span className="text-[9px] text-zinc-500 font-mono select-none leading-none mb-0.5">
                         {i >= 60 ? `${Math.floor(i / 60)}:${(i % 60).toString().padStart(2, '0')}` : `${i}s`}
                       </span>
                       <div className="w-px h-2 bg-zinc-600"></div>
                     </>
                   ) : (
                     <div className="w-px h-1 bg-zinc-700/50"></div>
                   )}
                 </div>
               );
            })}
          </div>

          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-px z-50 pointer-events-none"
            style={{ 
              left: `${progressPercent}%`,
              background: 'linear-gradient(to bottom, #ef4444, #ef444480)'
            }}
          >
            <div className="absolute top-0 -translate-x-1/2 w-3 h-3 rounded-sm shadow-lg bg-red-500 transform rotate-45" 
                 style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }}
            />
          </div>

          {/* Multi-Clip Track */}
          <div className="w-full relative flex items-center" style={{ height: 'calc(100% - 32px)', marginTop: '32px' }}>
             {duration > 0 && clips.map((clip, index) => {
                const clipStartPercent = (clip.startAt / duration) * 100;
                const clipWidthPercent = ((clip.trimEnd - clip.trimStart) / duration) * 100;
                const colorSet = CLIP_COLORS[index % CLIP_COLORS.length];
                const isDragging = draggingClipId === clip.id;
                const clipDuration = clip.trimEnd - clip.trimStart;
                
                return (
                  <ContextMenu key={clip.id}>
                    <ContextMenuTrigger 
                      className="absolute flex flex-col justify-center overflow-hidden group"
                      style={{ 
                        left: `${clipStartPercent}%`, 
                        width: `${clipWidthPercent}%`,
                        height: '70%',
                        cursor: bladeMode ? 'crosshair' : (isDragging ? 'grabbing' : 'grab'),
                        backgroundColor: isDragging && isSnapped ? colorSet.bg.replace('0.15', '0.35') : colorSet.bg,
                        borderWidth: '2px',
                        borderStyle: 'solid',
                        borderColor: isDragging && isSnapped ? colorSet.solid : colorSet.border,
                        borderRadius: '8px',
                        backdropFilter: 'blur(4px)',
                        zIndex: isDragging ? 50 : 10,
                        boxShadow: isDragging 
                          ? `0 10px 30px rgba(0,0,0,0.5), 0 0 20px ${colorSet.solid}40` 
                          : 'none',
                        transform: isDragging ? 'scale(1.03)' : 'scale(1)',
                        transition: isDragging ? 'box-shadow 0.2s, transform 0.15s' : 'box-shadow 0.3s, transform 0.2s, background-color 0.2s',
                      }}
                      onClick={(e) => handleTrackClick(e, clip.id)}
                      onPointerDown={(e) => handleClipPointerDown(e, clip.id, clip.startAt)}
                      onPointerMove={handleClipPointerMove}
                      onPointerUp={handleClipPointerUp}
                      onPointerCancel={handleClipPointerUp}
                    >
                        {/* Left Handle */}
                        <div 
                          className="absolute inset-y-0 left-0 w-1.5 rounded-l-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ backgroundColor: colorSet.handle }}
                        />
                        {/* Right Handle */}
                        <div 
                          className="absolute inset-y-0 right-0 w-1.5 rounded-r-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ backgroundColor: colorSet.handle }}
                        />
                        
                        {/* Clip Color Dot + Info */}
                        <div className="px-3 py-1 flex flex-col gap-0.5 select-none pointer-events-none">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colorSet.solid }} />
                            <span className="text-[10px] font-bold text-white/80 uppercase tracking-tighter truncate">
                              Clip {index + 1}
                            </span>
                          </div>
                          <span className="text-[9px] text-white/35 font-mono">
                            {formatTime(clip.trimStart)} → {formatTime(clip.trimEnd)} ({formatTime(clipDuration)})
                          </span>
                        </div>

                        {/* Snap indicator flash */}
                        {isDragging && isSnapped && (
                          <div 
                            className="absolute inset-0 rounded-md animate-pulse pointer-events-none"
                            style={{ 
                              border: `2px solid ${colorSet.solid}`,
                              boxShadow: `inset 0 0 12px ${colorSet.solid}30`
                            }}
                          />
                        )}
                    </ContextMenuTrigger>
                    <ContextMenuContent className="bg-zinc-900 border-zinc-700">
                      <ContextMenuItem 
                        className="text-red-400 focus:text-red-400 cursor-pointer flex items-center gap-2 hover:bg-red-500/10"
                        onClick={() => removeClip(clip.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar Clip
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
             })}
          </div>

        </motion.div>
      </div>

      {/* Footer Info */}
      <div className="flex justify-between items-center text-zinc-600 text-[10px] uppercase font-bold tracking-widest">
        <span className="font-mono">00:00.0</span>
        <span className={snappingActive ? 'text-indigo-400' : 'text-zinc-600'}>
          {snappingActive ? `⚡ Snapping Activo (${SNAP_THRESHOLD_PX}px)` : 'Snapping Off'}
        </span>
        <span className="font-mono">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
