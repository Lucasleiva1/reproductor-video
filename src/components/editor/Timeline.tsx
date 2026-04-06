
import { useTimeline } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";
import { FaPlay, FaPause } from "react-icons/fa";
import { Trash2, Magnet, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// --- CONFIGURACIÓN TÉCNICA ---
const SNAP_THRESHOLD_PX = 10;
const MIN_CLIP_DURATION = 0.2; // Minimum clip duration in seconds

// Colores para los clips alternados
const CLIP_COLORS = [
  { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.5)',  solid: '#6366f1', handle: 'rgba(99,102,241,0.7)' },
  { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.5)',  solid: '#10b981', handle: 'rgba(16,185,129,0.7)' },
  { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.5)',  solid: '#f59e0b', handle: 'rgba(245,158,11,0.7)' },
  { bg: 'rgba(236,72,153,0.15)',  border: 'rgba(236,72,153,0.5)',  solid: '#ec4899', handle: 'rgba(236,72,153,0.7)' },
  { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.5)',  solid: '#3b82f6', handle: 'rgba(59,130,246,0.7)' },
  { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.5)',  solid: '#a855f7', handle: 'rgba(168,85,247,0.7)' },
];

type DragMode = 'move' | 'trim-left' | 'trim-right' | null;

export default function Timeline() {
  const { t } = useTranslation();
  const { duration, currentTime, clips, splitClip, removeClip, videoFile, playing, setPlaying, setCurrentTime, bladeModeLimit, timelineTimeMode, showTips, thumbnails } = useTimeline();
  const [timelineZoom, setTimelineZoom] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
  const [bladeMode, setBladeMode] = useState(false);
  const [bladeCutsRemaining, setBladeCutsRemaining] = useState(bladeModeLimit || 2);
  const [snappingActive, setSnappingActive] = useState(true);

  // --- Usage Tips ---
  const TIPS_COUNT = 11;
  const [currentTip, setCurrentTip] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % TIPS_COUNT);
    }, 30 * 1000); // 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Unified drag state for move + trim
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [isSnapped, setIsSnapped] = useState(false);
  const [trimmingSide, setTrimmingSide] = useState<'left' | 'right' | null>(null);

  const isScrubbing = useRef(false);
  const lastClientX = useRef<number | null>(null);
  const autoPanActive = useRef<boolean>(false);
  const autoPanFrame = useRef<number | null>(null);

  const dragState = useRef<{
    id: string | null;
    mode: DragMode;
    startX: number;
    // Snapshot of clip state at drag start (for atomic updates)
    initialStartAt: number;
    initialTrimStart: number;
    initialTrimEnd: number;
    initialSourceDuration: number;
    // Snapshot of timeline state at drag start (prevents feedback loops)
    initialDuration: number;
    initialTrackWidth: number;
    initialScrollLeft: number;
  }>({
    id: null, mode: null, startX: 0,
    initialStartAt: 0, initialTrimStart: 0, initialTrimEnd: 0, initialSourceDuration: 0,
    initialDuration: 0, initialTrackWidth: 1, initialScrollLeft: 0,
  });

  // --- Keyboard Shortcuts (Undo/Redo) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useTimeline.getState().redo();
        } else {
          useTimeline.getState().undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- PLAYBACK AUTO-PAGINATION ---
  useEffect(() => {
    // Only auto-paginate when actively playing, and never when the user is actively dragging/scrubbing
    if (!playing || isScrubbing.current || dragState.current.id || duration === 0 || !scrollContainerRef.current || !trackRef.current) return;

    const container = scrollContainerRef.current;
    
    // Calculate the absolute pixel position of the playhead within the scrollable world
    const trackWidth = trackRef.current.getBoundingClientRect().width;
    const worldPlayheadX = trackRef.current.offsetLeft + (currentTime / duration) * trackWidth;
    
    const viewLeft = container.scrollLeft;
    const viewRight = container.scrollLeft + container.clientWidth;

    // Optional padding so it doesn't glue exactly to the pixels of the edge
    const EDGE_PADDING = 60; 

    if (worldPlayheadX > viewRight) {
      // Reached the right edge: jump the scroll so the playhead reappears at the left edge!
      container.scrollTo({
        left: worldPlayheadX - EDGE_PADDING,
        behavior: 'auto'
      });
    } else if (worldPlayheadX < viewLeft) {
      // Reached the left edge (e.g. video loops back or jumps back)
      container.scrollTo({
        left: Math.max(0, worldPlayheadX - EDGE_PADDING),
        behavior: 'auto'
      });
    }
  }, [currentTime, playing, duration]);

  // --- Helpers ---
  const getPxPerSec = useCallback(() => {
    if (duration <= 0 || !trackRef.current) return 1;
    return trackRef.current.getBoundingClientRect().width / duration;
  }, [duration]);

  const getSnapThresholdSec = useCallback(() => {
    const pps = getPxPerSec();
    return pps > 0 ? SNAP_THRESHOLD_PX / pps : 0.5;
  }, [getPxPerSec]);

  const formatTime = (secs: number) => {
    if (timelineTimeMode === 'hidden') return '';
    if (timelineTimeMode === 'minutes') {
      return `${Math.floor(secs / 60)}:${Math.floor(secs % 60).toString().padStart(2, '0')}`;
    }
    return `${secs.toFixed(1)}s`;
  };

  // --- DRAG START ---
  const startDrag = (e: React.PointerEvent, clipId: string, mode: DragMode) => {
    if (bladeMode && mode !== 'move') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Save history before modifying
    useTimeline.getState().saveHistory();

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    dragState.current = {
      id: clipId,
      mode,
      startX: e.clientX,
      initialStartAt: clip.startAt,
      initialTrimStart: clip.trimStart,
      initialTrimEnd: clip.trimEnd,
      initialSourceDuration: clip.sourceDuration,
      initialDuration: duration,
      initialTrackWidth: trackRef.current?.getBoundingClientRect().width || 1,
      initialScrollLeft: scrollContainerRef.current?.scrollLeft || 0,
    };
    setActiveClipId(clipId);
    setDragMode(mode);
    setTrimmingSide(mode === 'trim-left' ? 'left' : mode === 'trim-right' ? 'right' : null);
  };

  // --- SCRUBBING LOGIC ---
  const handleScrub = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setCurrentTime((x / rect.width) * duration);
  }, [duration, setCurrentTime]);

  // --- DRAG PROCESSING LOGIC ---
  const processDrag = useCallback((clientX: number) => {
    const ds = dragState.current;
    if (!ds.id || !ds.mode || !trackRef.current || !scrollContainerRef.current) return;

    // We must account for the timeline scrolling underneath our mouse
    const scrollDelta = scrollContainerRef.current.scrollLeft - ds.initialScrollLeft;
    const pxDelta = clientX - ds.startX + scrollDelta;
    
    // Use SNAPSHOTTED values from drag start to prevent feedback loops
    const timeDelta = (pxDelta / ds.initialTrackWidth) * ds.initialDuration;

    const store = useTimeline.getState();
    let snapped = false;

    if (ds.mode === 'move') {
      // --- MOVE CLIP ---
      let newStartAt = ds.initialStartAt + timeDelta;
      newStartAt = Math.max(0, newStartAt);
      const clipDur = ds.initialTrimEnd - ds.initialTrimStart;

      if (snappingActive) {
        const snapT = getSnapThresholdSec();
        const thisEnd = newStartAt + clipDur;
        const otherClips = clips.filter(c => c.id !== ds.id);

        for (const other of otherClips) {
          const otherEnd = other.startAt + (other.trimEnd - other.trimStart);
          const otherStart = other.startAt;

          if (Math.abs(newStartAt - otherEnd) < snapT) { newStartAt = otherEnd; snapped = true; break; }
          if (Math.abs(thisEnd - otherStart) < snapT) { newStartAt = otherStart - clipDur; snapped = true; break; }
          if (Math.abs(newStartAt - otherStart) < snapT) { newStartAt = otherStart; snapped = true; break; }
          if (Math.abs(thisEnd - otherEnd) < snapT) { newStartAt = otherEnd - clipDur; snapped = true; break; }
        }
        if (!snapped && Math.abs(newStartAt) < snapT) { newStartAt = 0; snapped = true; }
      }

      newStartAt = Math.max(0, newStartAt);
      store.updateClip(ds.id, { startAt: newStartAt });

    } else if (ds.mode === 'trim-left') {
      // --- TRIM LEFT ---
      let newTrimStart = ds.initialTrimStart + timeDelta;
      let newStartAt = ds.initialStartAt + timeDelta;

      if (newTrimStart < 0) {
        newStartAt -= newTrimStart;
        newTrimStart = 0;
      }

      const maxTrimStart = ds.initialTrimEnd - MIN_CLIP_DURATION;
      if (newTrimStart > maxTrimStart) {
        const overshoot = newTrimStart - maxTrimStart;
        newTrimStart = maxTrimStart;
        newStartAt -= overshoot;
      }

      if (newStartAt < 0) {
        newTrimStart -= newStartAt;
        newStartAt = 0;
      }

      const otherClips = clips.filter(c => c.id !== ds.id);
      for (const other of otherClips) {
        const otherEnd = other.startAt + (other.trimEnd - other.trimStart);
        if (other.startAt < ds.initialStartAt && newStartAt < otherEnd) {
          const diff = otherEnd - newStartAt;
          newStartAt = otherEnd;
          newTrimStart += diff;
        }
      }

      if (snappingActive) {
        const snapT = getSnapThresholdSec();
        for (const other of otherClips) {
          const otherEnd = other.startAt + (other.trimEnd - other.trimStart);
          if (Math.abs(newStartAt - otherEnd) < snapT) {
            const diff = newStartAt - otherEnd;
            newStartAt = otherEnd;
            newTrimStart -= diff;
            snapped = true;
            break;
          }
        }
        if (!snapped && Math.abs(newStartAt) < snapT) {
          newTrimStart -= newStartAt;
          newStartAt = 0;
          snapped = true;
        }
      }

      store.updateClip(ds.id, { startAt: newStartAt, trimStart: newTrimStart });

    } else if (ds.mode === 'trim-right') {
      // --- TRIM RIGHT ---
      let newTrimEnd = ds.initialTrimEnd + timeDelta;

      newTrimEnd = Math.min(newTrimEnd, ds.initialSourceDuration);
      newTrimEnd = Math.max(newTrimEnd, ds.initialTrimStart + MIN_CLIP_DURATION);

      const newEndOnTimeline = ds.initialStartAt + (newTrimEnd - ds.initialTrimStart);
      const otherClips = clips.filter(c => c.id !== ds.id);
      for (const other of otherClips) {
        if (other.startAt > ds.initialStartAt && newEndOnTimeline > other.startAt) {
          newTrimEnd = ds.initialTrimStart + (other.startAt - ds.initialStartAt);
        }
      }

      if (snappingActive) {
        const snapT = getSnapThresholdSec();
        const newEndTime = ds.initialStartAt + (newTrimEnd - ds.initialTrimStart);
        for (const other of otherClips) {
          if (Math.abs(newEndTime - other.startAt) < snapT) {
            newTrimEnd = ds.initialTrimStart + (other.startAt - ds.initialStartAt);
            snapped = true;
            break;
          }
          const otherEnd = other.startAt + (other.trimEnd - other.trimStart);
          if (Math.abs(newEndTime - otherEnd) < snapT) {
            newTrimEnd = ds.initialTrimStart + (otherEnd - ds.initialStartAt);
            snapped = true;
            break;
          }
        }
      }

      store.updateClip(ds.id, { trimEnd: newTrimEnd });
    }

    setIsSnapped(snapped);
  }, [clips, snappingActive, getSnapThresholdSec]);

  // --- AUTO-PANNING (EDGE SCROLL) LOGIC ---
  const triggerUpdateForDrag = useCallback((clientX: number) => {
    if (isScrubbing.current) {
      handleScrub(clientX);
    } else if (dragState.current.id) {
      processDrag(clientX);
    }
  }, [handleScrub, processDrag]);

  const stopAutoPanLoop = useCallback(() => {
    autoPanActive.current = false;
    if (autoPanFrame.current !== null) {
      cancelAnimationFrame(autoPanFrame.current);
      autoPanFrame.current = null;
    }
    lastClientX.current = null;
  }, []);

  const EDGE_ZONE = 50; // px
  const MAX_PAN_SPEED = 25; // px per frame

  const autoPanLoop = useCallback(() => {
    if (!autoPanActive.current || lastClientX.current === null || !scrollContainerRef.current) {
      autoPanFrame.current = null;
      return;
    }

    const container = scrollContainerRef.current;
    const rect = container.getBoundingClientRect();
    const clientX = lastClientX.current;

    let panAmount = 0;

    // Move left if near left edge
    if (clientX < rect.left + EDGE_ZONE) {
      const distanceToEdge = Math.max(0, clientX - rect.left);
      const intensity = 1 - (distanceToEdge / EDGE_ZONE);
      panAmount = -MAX_PAN_SPEED * (intensity * intensity); // exponential curve
    }
    // Move right if near right edge
    else if (clientX > rect.right - EDGE_ZONE) {
      const distanceToEdge = Math.max(0, rect.right - clientX);
      const intensity = 1 - (distanceToEdge / EDGE_ZONE);
      panAmount = MAX_PAN_SPEED * (intensity * intensity); // exponential curve
    }

    if (panAmount !== 0) {
      container.scrollLeft += panAmount;
      // Re-trigger the active intent with updated scroll!
      triggerUpdateForDrag(clientX);
    }

    autoPanFrame.current = requestAnimationFrame(autoPanLoop);
  }, [triggerUpdateForDrag]);

  const updateAutoPan = useCallback((clientX: number, isActive: boolean) => {
    lastClientX.current = clientX;
    
    if (isActive) {
      if (!autoPanActive.current) {
        autoPanActive.current = true;
        autoPanFrame.current = requestAnimationFrame(autoPanLoop);
      }
    } else {
      stopAutoPanLoop();
    }
  }, [autoPanLoop, stopAutoPanLoop]);

  // --- DRAG EVENT HANDLERS ---
  const onDragMove = useCallback((e: React.PointerEvent) => {
    processDrag(e.clientX);
    updateAutoPan(e.clientX, true);
  }, [processDrag, updateAutoPan]);

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    updateAutoPan(e.clientX, false);
    if (dragState.current.id) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      dragState.current.id = null;
      dragState.current.mode = null;
      setActiveClipId(null);
      setDragMode(null);
      setIsSnapped(false);
      setTrimmingSide(null);
    }
  }, [updateAutoPan]);

  // --- Blade Tool ---
  const handleBladeClick = (e: React.MouseEvent, clipId: string) => {
    if (!bladeMode || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    splitClip(clipId, (x / rect.width) * duration);

    // Handle cut counter
    if (bladeModeLimit === 0) {
      // Unlimited mode: stay active
      return;
    }
    const remaining = bladeCutsRemaining - 1;
    if (remaining <= 0) {
      setBladeMode(false);
      setBladeCutsRemaining(bladeModeLimit);
    } else {
      setBladeCutsRemaining(remaining);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // --- Middle-mouse panning ---
  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      panRef.current = { isDragging: true, startX: e.pageX - (scrollContainerRef.current?.offsetLeft || 0), scrollLeft: scrollContainerRef.current?.scrollLeft || 0 };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current.isDragging || !scrollContainerRef.current) return;
    scrollContainerRef.current.scrollLeft = panRef.current.scrollLeft - (e.pageX - scrollContainerRef.current.offsetLeft - panRef.current.startX);
  };
  const onPanEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current.isDragging) { panRef.current.isDragging = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {} }
  };

  return (
    <div className="flex-1 flex w-full relative bg-[#0c0c0e]/95 backdrop-blur-sm p-6 flex-col gap-4 overflow-hidden">
      {/* Header Row */}
      <div className="flex justify-between items-center w-full">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-lg text-white tracking-tight flex items-center gap-3">
             {videoFile?.name || t('timeline_title')}
             <button onClick={() => setPlaying(!playing)} className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full w-9 h-9 transition-all shadow-lg shadow-indigo-500/20">
                {playing ? <FaPause className="w-3 h-3" /> : <FaPlay className="w-3 h-3 translate-x-0.5" />}
             </button>
             <button 
               onClick={() => {
                 const newVal = !bladeMode;
                 setBladeMode(newVal);
                 if (newVal) setBladeCutsRemaining(bladeModeLimit || 2);
               }} 
               title={bladeMode ? (bladeModeLimit === 0 ? 'Cortando... (∞)' : `Cortando... (${bladeCutsRemaining} restante${bladeCutsRemaining !== 1 ? 's' : ''})`) : 'Blade Tool'}
               className={`p-2 rounded-lg transition-all flex items-center justify-center relative ${bladeMode ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 scale-110' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
             >
               <span className="text-base leading-none">✂️</span>
               {bladeMode && bladeModeLimit !== 0 && (
                 <span className="absolute -top-1.5 -right-1.5 bg-white text-red-600 text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-md">
                   {bladeCutsRemaining}
                 </span>
               )}
               {bladeMode && bladeModeLimit === 0 && (
                 <span className="absolute -top-1.5 -right-1.5 bg-white text-red-600 text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-md">
                   ∞
                 </span>
               )}
             </button>
             <button
               onClick={() => setSnappingActive(!snappingActive)}
               title={snappingActive ? 'Snapping Activo (10px)' : 'Snapping Desactivado'}
               className={`p-2 rounded-lg transition-all flex items-center justify-center ${snappingActive ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
             >
               <Magnet className="w-3.5 h-3.5" />
             </button>
          </span>
          {showTips && (
            <div className="flex items-center gap-2 min-h-[20px]">
              <div className="p-1 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Lightbulb className="w-3 h-3 text-amber-400" />
              </div>
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentTip}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="text-zinc-500 text-xs leading-snug cursor-pointer hover:text-zinc-400 transition-colors"
                  onClick={() => setCurrentTip(prev => (prev + 1) % TIPS_COUNT)}
                  title={`Tip ${currentTip + 1}/${TIPS_COUNT}`}
                >
                  <span className="text-amber-400/70 font-semibold text-[10px] mr-1.5">{currentTip + 1}/{TIPS_COUNT}</span>
                  {t(`tip_${currentTip + 1}`)}
                </motion.span>
              </AnimatePresence>
            </div>
          )}
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
        className={`flex-1 overflow-x-scroll overflow-y-hidden custom-scrollbar pb-2 relative rounded-xl border border-zinc-800/50 bg-zinc-900/30 ${bladeMode ? 'cursor-crosshair' : ''}`}
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.3) inset' }}
        onPointerDown={onPanStart} onPointerMove={onPanMove} onPointerUp={onPanEnd}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      >
        <motion.div 
          ref={trackRef}
          className="h-full relative flex items-center shrink-0 origin-left"
          animate={{ 
            width: `calc(${timelineZoom * 100}% - 32px)`,
            margin: '0 16px' 
          }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        >
          {/* Background Grid Lines */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {duration > 0 && Array.from({ length: Math.min(Math.ceil(duration / (timelineZoom > 5 ? 1 : timelineZoom > 2 ? 5 : 10)) + 1, 200) }).map((_, i) => {
              const step = timelineZoom > 5 ? 1 : timelineZoom > 2 ? 5 : 10;
              const sec = i * step;
              if (sec > duration) return null;
              return <div key={i} className="absolute top-0 bottom-0 w-px bg-white/[0.03]" style={{ left: `${(sec / duration) * 100}%` }} />;
            })}
          </div>

          {/* Scrubbing Ruler */}
          <div 
            className="absolute top-0 left-0 right-0 h-8 z-40 hover:bg-white/[0.02] transition-colors border-b border-zinc-800/50"
            style={{ cursor: bladeMode ? 'crosshair' : 'col-resize' }}
            onPointerDown={(e) => { 
                if (!bladeMode) { 
                   e.currentTarget.setPointerCapture(e.pointerId); 
                   isScrubbing.current = true;
                   handleScrub(e.clientX); 
                   updateAutoPan(e.clientX, true);
                } 
            }}
            onPointerMove={(e) => { 
                if (!bladeMode && isScrubbing.current) { 
                    handleScrub(e.clientX); 
                    updateAutoPan(e.clientX, true);
                } 
            }}
            onPointerUp={(e) => {
                isScrubbing.current = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                updateAutoPan(e.clientX, false);
            }}
            onPointerCancel={(e) => {
                isScrubbing.current = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                updateAutoPan(e.clientX, false);
            }}
          >
            {duration > 0 && Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => {
               if (i > duration) return null;
                const pxPerSec = (timelineZoom * 1000) / duration;
                let majorStep = 1;

                if (timelineTimeMode === 'minutes') {
                  // In minutes mode, we want labels at 1:00, 2:00, or at most 0:30 increments
                  if (pxPerSec < 2) majorStep = 300; // 5 min
                  else if (pxPerSec < 5) majorStep = 120; // 2 min
                  else if (pxPerSec < 15) majorStep = 60; // 1 min
                  else majorStep = 30; // 30 sec
                } else {
                  // Seconds mode (legacy logic)
                  if (pxPerSec < 4) majorStep = 60;
                  else if (pxPerSec < 10) majorStep = 30;
                  else if (pxPerSec < 20) majorStep = 10;
                  else if (pxPerSec < 40) majorStep = 5;
                }

                const isMajor = i % majorStep === 0;
                if (!isMajor && pxPerSec <= 3) return null;
               return (
                 <div key={i} className="absolute bottom-0 flex flex-col items-center -translate-x-1/2 pointer-events-none" style={{ left: `${(i / Math.max(duration, 0.1)) * 100}%` }}>
                   {isMajor ? (
                     <>
                        {timelineTimeMode !== 'hidden' && (
                          <span className="text-[9px] text-zinc-500 font-mono select-none leading-none mb-0.5">
                            {formatTime(i)}
                          </span>
                        )}
                       <div className="w-px h-2 bg-zinc-600" />
                     </>
                   ) : <div className="w-px h-1 bg-zinc-700/50" />}
                 </div>
               );
            })}
          </div>

          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-px z-50 pointer-events-none"
            style={{ left: `${progressPercent}%`, background: 'linear-gradient(to bottom, #ef4444, #ef444480)' }}
          >
            <div className="absolute top-0 -translate-x-1/2 w-3 h-3 rounded-sm shadow-lg bg-red-500 transform rotate-45" style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }} />
          </div>

          {/* Multi-Clip Track */}
          <div className="w-full relative flex items-center" style={{ height: 'calc(100% - 32px)', marginTop: '32px' }}>
             {duration > 0 && clips.map((clip, index) => {
                const clipDur = clip.trimEnd - clip.trimStart;
                const clipStartPct = (clip.startAt / duration) * 100;
                const clipWidthPct = (clipDur / duration) * 100;
                const color = CLIP_COLORS[index % CLIP_COLORS.length];
                const isDragging = activeClipId === clip.id;
                const isTrimming = isDragging && (dragMode === 'trim-left' || dragMode === 'trim-right');
                
                return (
                  <ContextMenu key={clip.id}>
                    <ContextMenuTrigger
                      className="absolute group select-none"
                      style={{ 
                        left: `${clipStartPct}%`, 
                        width: `${clipWidthPct}%`,
                        height: '70%',
                        zIndex: isDragging ? 50 : 10,
                      }}
                    >
                        {/* ===== CLIP BODY (drag to move) ===== */}
                        <div
                          className="absolute inset-0 flex flex-col justify-center overflow-hidden"
                          style={{ 
                            cursor: bladeMode ? 'crosshair' : (isDragging && dragMode === 'move' ? 'grabbing' : 'grab'),
                            backgroundColor: isDragging && isSnapped ? color.bg.replace('0.15', '0.35') : color.bg,
                            borderWidth: '2px',
                            borderStyle: 'solid',
                            borderColor: isTrimming ? '#fff' : (isDragging && isSnapped ? color.solid : color.border),
                            borderRadius: '8px',
                            backdropFilter: 'blur(4px)',
                            boxShadow: isDragging 
                              ? `0 10px 30px rgba(0,0,0,0.5), 0 0 20px ${color.solid}40` 
                              : 'none',
                            transform: isDragging && dragMode === 'move' ? 'scaleY(1.06)' : 'scaleY(1)',
                            transition: 'box-shadow 0.2s, transform 0.15s, background-color 0.2s, border-color 0.15s',
                          }}
                          onClick={(e) => handleBladeClick(e, clip.id)}
                          onPointerDown={(e) => startDrag(e, clip.id, 'move')}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                        >
                          {/* Thumbnails strip */}
                          {thumbnails.length > 0 && (
                            <div 
                              className="absolute top-0 bottom-0 pointer-events-none flex overflow-hidden opacity-60"
                              style={{
                                width: `${(clip.sourceDuration / clipDur) * 100}%`,
                                left: `${-(clip.trimStart / clipDur) * 100}%`
                              }}
                            >
                              {(() => {
                                // Dynamically calculate how many thumbnails to render based on physical zoom width
                                // to maintain a 16:9 aspect ratio and avoid the "barcode" / squished effect.
                                const trackW = trackRef.current ? trackRef.current.getBoundingClientRect().width : 1000 * timelineZoom;
                                const pxPerSec = duration > 0 ? trackW / duration : 100;
                                const sourceWidthPx = clip.sourceDuration * pxPerSec;
                                
                                const THUMB_WIDTH = 80; // Fixed pixel width for 16:9 look
                                const numWanted = Math.max(1, Math.ceil(sourceWidthPx / THUMB_WIDTH));
                                
                                const elements = [];
                                for (let i = 0; i < numWanted; i++) {
                                  // Time this exact thumbnail box represents logically
                                  const boxTimeSecs = (i * THUMB_WIDTH) / Math.max(0.1, pxPerSec);
                                  
                                  // Map this time to the closest available pre-calculated thumbnail
                                  const thumbIndex = Math.min(
                                    thumbnails.length - 1, 
                                    Math.floor((boxTimeSecs / clip.sourceDuration) * thumbnails.length)
                                  );
                                  const src = thumbnails[Math.max(0, thumbIndex)] || '';
                                  
                                  elements.push(
                                    <div 
                                      key={i} 
                                      className="h-full shrink-0 border-r border-black/20"
                                      style={{ 
                                        width: `${THUMB_WIDTH}px`,
                                        backgroundImage: `url(${src})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center' 
                                      }}
                                    />
                                  );
                                }
                                return elements;
                              })()}
                            </div>
                          )}

                          {/* Clip Info */}
                          <div className="px-3 py-1.5 flex flex-col gap-0.5 select-none pointer-events-none relative z-10 bg-gradient-to-b from-black/60 to-transparent">
                            <div className="flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color.solid }} />
                              <span className="text-[10px] font-bold text-white uppercase tracking-tighter truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                Clip {index + 1}
                              </span>
                            </div>
                            <span className="text-[9px] text-white/80 font-mono" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                              {formatTime(clip.trimStart)} → {formatTime(clip.trimEnd)} ({formatTime(clipDur)})
                            </span>
                          </div>

                          {/* Snap indicator */}
                          {isDragging && isSnapped && (
                            <div className="absolute inset-0 rounded-md animate-pulse pointer-events-none"
                              style={{ border: `2px solid ${color.solid}`, boxShadow: `inset 0 0 12px ${color.solid}30` }}
                            />
                          )}
                        </div>

                        {/* ===== LEFT TRIM HANDLE ===== */}
                        <div
                          className="absolute top-0 bottom-0 left-0 w-3 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ 
                            cursor: 'ew-resize',
                            transform: 'translateX(-50%)',
                          }}
                          onPointerDown={(e) => startDrag(e, clip.id, 'trim-left')}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                        >
                          {/* Top dot */}
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 bg-white shadow-lg"
                            style={{ borderColor: color.solid, boxShadow: `0 0 6px ${color.solid}80` }}
                          />
                          {/* Center bar */}
                          <div className="w-1 rounded-full" 
                            style={{ height: '40%', backgroundColor: color.handle, opacity: trimmingSide === 'left' && isDragging ? 1 : undefined }} 
                          />
                          {/* Bottom dot */}
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 rounded-full border-2 bg-white shadow-lg"
                            style={{ borderColor: color.solid, boxShadow: `0 0 6px ${color.solid}80` }}
                          />
                        </div>

                        {/* ===== RIGHT TRIM HANDLE ===== */}
                        <div
                          className="absolute top-0 bottom-0 right-0 w-3 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ 
                            cursor: 'ew-resize',
                            transform: 'translateX(50%)',
                          }}
                          onPointerDown={(e) => startDrag(e, clip.id, 'trim-right')}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                        >
                          {/* Top dot */}
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 bg-white shadow-lg"
                            style={{ borderColor: color.solid, boxShadow: `0 0 6px ${color.solid}80` }}
                          />
                          {/* Center bar */}
                          <div className="w-1 rounded-full" 
                            style={{ height: '40%', backgroundColor: color.handle, opacity: trimmingSide === 'right' && isDragging ? 1 : undefined }} 
                          />
                          {/* Bottom dot */}
                          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 rounded-full border-2 bg-white shadow-lg"
                            style={{ borderColor: color.solid, boxShadow: `0 0 6px ${color.solid}80` }}
                          />
                        </div>
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

      {/* Footer */}
      <div className="flex justify-between items-center text-zinc-600 text-[10px] uppercase font-bold tracking-widest">
        <span className="font-mono">00:00.0</span>
        <span className={snappingActive ? 'text-indigo-400' : 'text-zinc-600'}>
          {trimmingSide ? `✏️ Trimming ${trimmingSide === 'left' ? 'Inicio' : 'Final'}` : snappingActive ? `Snapping Activo (${SNAP_THRESHOLD_PX}px)` : 'Snapping Off'}
        </span>
        <span className="font-mono">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
