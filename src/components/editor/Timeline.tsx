
import { useTimeline, type Clip } from "@/hooks/useTimeline";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";
import { FaPlay, FaPause } from "react-icons/fa";
import { Trash2, Magnet, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getClipDuration, getContentDuration } from "@/utils/timeline";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// --- CONFIGURACIÓN TÉCNICA ---
const SNAP_THRESHOLD_PX = 10;
const MIN_CLIP_DURATION = 0.2; // Minimum clip duration in seconds
const BASE_PIXELS_PER_SECOND = 18;

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

function TimelineFilmstrip({
  clip,
  clipWidthPx,
  thumbnails,
  isGeneratingThumbnails,
}: {
  clip: Clip;
  clipWidthPx: number;
  thumbnails: string[];
  isGeneratingThumbnails: boolean;
}) {
  const clipDur = getClipDuration(clip);
  const usableThumbnails = thumbnails.filter(Boolean);
  const thumbCount = usableThumbnails.length;
  const tileTargetWidth = 104;
  const tileCount = Math.max(1, Math.min(64, Math.ceil(clipWidthPx / tileTargetWidth)));

  if (thumbCount === 0) {
    return (
      <div className="absolute inset-x-0 top-1/2 h-[46px] -translate-y-1/2 overflow-hidden bg-black/90 ring-1 ring-black">
        <div className={`h-full w-full ${isGeneratingThumbnails ? 'animate-pulse bg-gradient-to-r from-zinc-950 via-zinc-800 to-zinc-950' : 'bg-zinc-950'}`} />
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-1/2 h-[46px] -translate-y-1/2 overflow-hidden bg-black ring-1 ring-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <div className="flex h-full gap-px bg-black">
        {Array.from({ length: tileCount }).map((_, i) => {
          const tileMidpoint = (i + 0.5) / tileCount;
          const sourceTime = clip.trimStart + tileMidpoint * clipDur;
          const thumbIndex = Math.max(
            0,
            Math.min(thumbCount - 1, Math.round((sourceTime / Math.max(0.1, clip.sourceDuration)) * (thumbCount - 1)))
          );

          return (
            <div key={i} className="h-full min-w-0 flex-1 overflow-hidden bg-black">
              <img
                src={usableThumbnails[thumbIndex]}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-cover opacity-95 contrast-110 saturate-110"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlayheadProps {
  pixelsPerSecond: number;
  trackWidthPx: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  trackRef: React.RefObject<HTMLDivElement | null>;
  isScrubbingRef: React.RefObject<boolean>;
  dragStateRef: React.RefObject<any>;
  handleScrub: (clientX: number) => void;
  updateAutoPan: (clientX: number, active: boolean) => void;
}

function TimelinePlayhead({
  pixelsPerSecond,
  trackWidthPx,
  scrollContainerRef,
  trackRef,
  isScrubbingRef,
  dragStateRef,
  handleScrub,
  updateAutoPan,
}: PlayheadProps) {
  const currentTime = useTimeline((s) => s.currentTime);
  const duration = useTimeline((s) => s.duration);
  const playing = useTimeline((s) => s.playing);

  useEffect(() => {
    if (
      !playing ||
      isScrubbingRef.current ||
      dragStateRef.current?.id ||
      duration === 0 ||
      !scrollContainerRef.current ||
      !trackRef.current
    )
      return;

    const container = scrollContainerRef.current;
    const worldPlayheadX = trackRef.current.offsetLeft + currentTime * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const viewRight = container.scrollLeft + container.clientWidth;
    const EDGE_PADDING = 60;

    if (worldPlayheadX > viewRight) {
      container.scrollTo({
        left: worldPlayheadX - EDGE_PADDING,
        behavior: "auto",
      });
    } else if (worldPlayheadX < viewLeft) {
      container.scrollTo({
        left: Math.max(0, worldPlayheadX - EDGE_PADDING),
        behavior: "auto",
      });
    }
  }, [
    currentTime,
    duration,
    pixelsPerSecond,
    playing,
    isScrubbingRef,
    dragStateRef,
    scrollContainerRef,
    trackRef,
  ]);

  const progressLeftPx = Math.max(0, Math.min(currentTime * pixelsPerSecond, trackWidthPx));

  return (
    <div
      className="absolute top-0 bottom-0 w-px z-50"
      style={{ left: `${progressLeftPx}px`, background: "linear-gradient(to bottom, #ef4444, #ef444480)", pointerEvents: 'none' }}
    >
      {/* Visible diamond head */}
      <div
        className="absolute top-0 -translate-x-1/2 w-3 h-3 rounded-sm shadow-lg bg-red-500 transform rotate-45"
        style={{ boxShadow: "0 0 8px rgba(239,68,68,0.6)", pointerEvents: 'none' }}
      />
      {/* Full-height wide drag handle — extends above & below for easy grab */}
      <div
        className="absolute -translate-x-1/2 cursor-col-resize group/handle"
        style={{
          top: '-12px',
          bottom: '-12px',
          width: '32px',
          pointerEvents: 'auto',
          zIndex: 60,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          isScrubbingRef.current = true;
          handleScrub(e.clientX);
          updateAutoPan(e.clientX, true);
        }}
        onPointerMove={(e) => {
          if (isScrubbingRef.current) {
            handleScrub(e.clientX);
            updateAutoPan(e.clientX, true);
          }
        }}
        onPointerUp={(e) => {
          isScrubbingRef.current = false;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
          updateAutoPan(e.clientX, false);
        }}
        onPointerCancel={(e) => {
          isScrubbingRef.current = false;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
          updateAutoPan(e.clientX, false);
        }}
      >
        {/* Visible hover stripe so you know you can grab it */}
        <div className="absolute inset-0 rounded-sm bg-red-500/0 group-hover/handle:bg-red-500/10 active:bg-red-500/20 transition-colors" />
      </div>
    </div>
  );
}

export default function Timeline() {
  const { t } = useTranslation();
  
  const duration = useTimeline((s) => s.duration);
  const clips = useTimeline((s) => s.clips);
  const splitClip = useTimeline((s) => s.splitClip);
  const removeClip = useTimeline((s) => s.removeClip);
  const videoFile = useTimeline((s) => s.videoFile);
  const playing = useTimeline((s) => s.playing);
  const setPlaying = useTimeline((s) => s.setPlaying);
  const setCurrentTime = useTimeline((s) => s.setCurrentTime);
  const bladeModeLimit = useTimeline((s) => s.bladeModeLimit);
  const timelineTimeMode = useTimeline((s) => s.timelineTimeMode);
  const showTips = useTimeline((s) => s.showTips);
  const thumbnails = useTimeline((s) => s.thumbnails);
  const isGeneratingThumbnails = useTimeline((s) => s.isGeneratingThumbnails);
  const ensureThumbnails = useTimeline((s) => s.ensureThumbnails);

  const [timelineZoom, setTimelineZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
  const [bladeMode, setBladeMode] = useState(false);
  const [bladeCutsRemaining, setBladeCutsRemaining] = useState(bladeModeLimit || 2);
  const [snappingActive, setSnappingActive] = useState(true);
  const contentDuration = getContentDuration(clips);
  const viewDuration = Math.max(duration, contentDuration + 10, 30);

  // ResizeObserver to dynamically obtain container width
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width || 800);
      }
    });
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const fitZoom = ((containerWidth * 0.5) / viewDuration) / BASE_PIXELS_PER_SECOND;
  const minZoom = Math.max(0.001, Math.min(1, fitZoom));
  const maxZoom = 10;

  // Clamp current zoom to dynamic bounds
  useEffect(() => {
    setTimelineZoom((prev) => Math.max(minZoom, Math.min(maxZoom, prev)));
  }, [minZoom, maxZoom]);

  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * timelineZoom;
  const trackWidthPx = Math.max(100, viewDuration * pixelsPerSecond);

  useEffect(() => {
    ensureThumbnails();
  }, [ensureThumbnails, clips.length]);

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

  // --- Helpers ---
  const getPxPerSec = useCallback(() => {
    return pixelsPerSecond;
  }, [pixelsPerSecond]);

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
    setCurrentTime(Math.min(viewDuration, x / pixelsPerSecond));
  }, [pixelsPerSecond, setCurrentTime, viewDuration]);

  // --- DRAG PROCESSING LOGIC ---
  const processDrag = useCallback((clientX: number) => {
    const ds = dragState.current;
    if (!ds.id || !ds.mode || !trackRef.current || !scrollContainerRef.current) return;

    // We must account for the timeline scrolling underneath our mouse
    const scrollDelta = scrollContainerRef.current.scrollLeft - ds.initialScrollLeft;
    const pxDelta = clientX - ds.startX + scrollDelta;
    
    const timeDelta = pxDelta / pixelsPerSecond;

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
  }, [clips, snappingActive, getSnapThresholdSec, pixelsPerSecond]);

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
    splitClip(clipId, x / pixelsPerSecond);

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
             <button 
               onClick={() => setPlaying(!playing)} 
               aria-label={playing ? "Pausar reproducción" : "Iniciar reproducción"}
               className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-full w-9 h-9 transition-colors shadow-lg shadow-indigo-500/20"
             >
                {playing ? <FaPause className="w-3 h-3" /> : <FaPlay className="w-3 h-3 translate-x-0.5" />}
             </button>
             <button 
               onClick={() => {
                 const newVal = !bladeMode;
                 setBladeMode(newVal);
                 if (newVal) setBladeCutsRemaining(bladeModeLimit || 2);
               }} 
               title={bladeMode ? (bladeModeLimit === 0 ? 'Cortando… (∞)' : `Cortando… (${bladeCutsRemaining} restante${bladeCutsRemaining !== 1 ? 's' : ''})`) : 'Blade Tool'}
               aria-label={bladeMode ? "Desactivar herramienta de corte" : "Activar herramienta de corte"}
               className={`p-2 rounded-lg transition-colors flex items-center justify-center relative ${bladeMode ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 scale-110' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
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
               aria-label={snappingActive ? "Desactivar auto-ajuste" : "Activar auto-ajuste"}
               className={`p-2 rounded-lg transition-colors flex items-center justify-center ${snappingActive ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
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
            {(() => {
              let sliderValue = 1.0;
              if (timelineZoom <= 1.0) {
                const denom = 1.0 - minZoom;
                sliderValue = denom > 0 ? (timelineZoom - minZoom) / denom : 0;
              } else {
                const denom = maxZoom - 1.0;
                sliderValue = denom > 0 ? 1.0 + (timelineZoom - 1.0) / denom : 2.0;
              }

              return (
                <Slider
                  value={[sliderValue]}
                  min={0}
                  max={2}
                  step={0.01}
                  onValueChange={(val) => {
                    const progress = Array.isArray(val) ? val[0] : val as number;
                    let nextZoom = 1.0;
                    if (progress <= 1.0) {
                      nextZoom = minZoom + (1.0 - minZoom) * progress;
                    } else {
                      nextZoom = 1.0 + (maxZoom - 1.0) * (progress - 1.0);
                    }
                    setTimelineZoom(nextZoom);
                  }}
                />
              );
            })()}
          </div>
        </div>
      </div>

      {/* Timeline Rail */}
      <div 
        ref={scrollContainerRef}
        className={`flex-1 overflow-x-scroll overflow-y-hidden custom-scrollbar pb-2 relative rounded-xl border border-zinc-800/50 bg-zinc-900/30 ${bladeMode ? 'cursor-crosshair' : ''}`}
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.3) inset' }}
        onPointerDown={onPanStart} onPointerMove={onPanMove} onPointerUp={onPanEnd}
      >
        <motion.div 
          ref={trackRef}
          className="h-full relative flex items-center shrink-0 origin-left"
          animate={{ 
            width: `${trackWidthPx}px`,
            margin: '0 16px' 
          }}
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        >
          {/* Background Grid Lines */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {(() => {
              if (viewDuration <= 0) return null;
              const pxPerSec = pixelsPerSecond;
              let step = 10;
              if (pxPerSec < 0.1) step = 3600;
              else if (pxPerSec < 0.25) step = 1800;
              else if (pxPerSec < 0.5) step = 600;
              else if (pxPerSec < 2) step = 300;
              else if (pxPerSec < 5) step = 120;
              else if (pxPerSec < 15) step = 60;
              else step = 30;

              const lines = [];
              const totalLines = Math.floor(viewDuration / step);
              for (let i = 0; i <= totalLines; i++) {
                const sec = i * step;
                lines.push(<div key={sec} className="absolute top-0 bottom-0 w-px bg-white/[0.03]" style={{ left: `${sec * pixelsPerSecond}px` }} />);
              }
              return lines;
            })()}
          </div>

          {/* Scrubbing Ruler – tall hit area for easy seeking */}
          <div 
            className="absolute top-0 left-0 right-0 h-10 z-40 hover:bg-white/[0.02] transition-colors border-b border-zinc-800/50"
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
            {(() => {
              if (viewDuration <= 0) return null;

              const pxPerSec = pixelsPerSecond;
              let majorStep = 1;

              if (timelineTimeMode === 'minutes') {
                if (pxPerSec < 0.1) majorStep = 3600;
                else if (pxPerSec < 0.25) majorStep = 1800;
                else if (pxPerSec < 0.5) majorStep = 600;
                else if (pxPerSec < 2) majorStep = 300;
                else if (pxPerSec < 5) majorStep = 120;
                else if (pxPerSec < 15) majorStep = 60;
                else majorStep = 30;
              } else {
                if (pxPerSec < 0.1) majorStep = 3600;
                else if (pxPerSec < 0.25) majorStep = 1800;
                else if (pxPerSec < 0.5) majorStep = 600;
                else if (pxPerSec < 1) majorStep = 120;
                else if (pxPerSec < 4) majorStep = 60;
                else if (pxPerSec < 10) majorStep = 30;
                else if (pxPerSec < 20) majorStep = 10;
                else if (pxPerSec < 40) majorStep = 5;
              }

              const minorStep = pxPerSec <= 3 ? majorStep : (majorStep / 5 >= 1 ? majorStep / 5 : 1);
              const ticks = [];
              const totalTicksCount = Math.ceil(viewDuration / minorStep);

              for (let i = 0; i <= totalTicksCount; i++) {
                const sec = i * minorStep;
                if (sec > viewDuration) break;

                const isMajor = sec % majorStep === 0;
                ticks.push(
                  <div key={sec} className="absolute bottom-0 flex flex-col items-center -translate-x-1/2 pointer-events-none" style={{ left: `${sec * pixelsPerSecond}px` }}>
                    {isMajor ? (
                      <>
                        {timelineTimeMode !== 'hidden' && (
                          <span className="text-[9px] text-zinc-500 font-mono select-none leading-none mb-0.5">
                            {formatTime(sec)}
                          </span>
                        )}
                        <div className="w-px h-2 bg-zinc-600" />
                      </>
                    ) : <div className="w-px h-1 bg-zinc-700/50" />}
                  </div>
                );
              }
              return ticks;
            })()}
          </div>

          {/* Playhead */}
          <TimelinePlayhead
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
            scrollContainerRef={scrollContainerRef}
            trackRef={trackRef}
            isScrubbingRef={isScrubbing}
            dragStateRef={dragState}
            handleScrub={handleScrub}
            updateAutoPan={updateAutoPan}
          />

          {/* Background scrub area – click empty space to seek */}
          <div
            className="absolute left-0 right-0 bottom-0 z-[1]"
            style={{ top: '40px', cursor: bladeMode ? 'crosshair' : 'col-resize' }}
            onPointerDown={(e) => {
              if (bladeMode) return;
              // Only scrub if clicking on the empty background, not on a clip
              if ((e.target as HTMLElement).closest('[data-clip-body]')) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              isScrubbing.current = true;
              handleScrub(e.clientX);
              updateAutoPan(e.clientX, true);
            }}
            onPointerMove={(e) => {
              if (!bladeMode && isScrubbing.current) {
                handleScrub(e.clientX);
                updateAutoPan(e.clientX, true);
              }
            }}
            onPointerUp={(e) => {
              if (isScrubbing.current) {
                isScrubbing.current = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                updateAutoPan(e.clientX, false);
              }
            }}
            onPointerCancel={(e) => {
              if (isScrubbing.current) {
                isScrubbing.current = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                updateAutoPan(e.clientX, false);
              }
            }}
          />

          {/* Multi-Clip Track */}
          <div className="w-full relative flex items-center" style={{ height: 'calc(100% - 40px)', marginTop: '40px' }}>
             {viewDuration > 0 && clips.map((clip, index) => {
                const clipDur = getClipDuration(clip);
                const clipStartPx = clip.startAt * pixelsPerSecond;
                const clipWidthPx = Math.max(1, clipDur * pixelsPerSecond);
                const color = CLIP_COLORS[index % CLIP_COLORS.length];
                const isDragging = activeClipId === clip.id;
                const isTrimming = isDragging && (dragMode === 'trim-left' || dragMode === 'trim-right');
                
                return (
                  <ContextMenu key={clip.id}>
                    <ContextMenuTrigger
                      className="absolute group select-none"
                      style={{ 
                        left: `${clipStartPx}px`, 
                        width: `${clipWidthPx}px`,
                        height: '70%',
                        zIndex: isDragging ? 50 : 10,
                      }}
                    >
                        {/* ===== CLIP BODY (drag to move) ===== */}
                        <div
                          className="absolute inset-0 flex flex-col justify-center overflow-hidden"
                          style={{ 
                            cursor: bladeMode ? 'crosshair' : (isDragging && dragMode === 'move' ? 'grabbing' : 'grab'),
                            backgroundColor: isDragging && isSnapped ? color.bg.replace('0.15', '0.35') : '#101014',
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
                          <div className="absolute inset-x-0 top-0 h-[18px] bg-black/80 pointer-events-none" />
                          <div className="absolute inset-x-0 bottom-0 h-[18px] bg-black/80 pointer-events-none" />
                          <TimelineFilmstrip
                            clip={clip}
                            clipWidthPx={clipWidthPx}
                            thumbnails={thumbnails}
                            isGeneratingThumbnails={isGeneratingThumbnails}
                          />

                          {/* Clip Info */}
                          <div className="px-2 py-1.5 flex flex-col gap-1 select-none pointer-events-none relative z-10">
                            <div className="flex w-fit max-w-[calc(100%-8px)] items-center gap-1.5 rounded-[4px] border border-white/10 bg-black/75 px-2 py-0.5 shadow-sm">
                              <div className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color.solid }} />
                              <span className="text-[9px] font-bold text-white uppercase tracking-normal truncate">
                                Clip {index + 1}
                              </span>
                            </div>
                            <span className="w-fit max-w-[calc(100%-8px)] rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[8px] text-white/75 font-mono truncate">
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
        <span className="font-mono">{formatTime(viewDuration)}</span>
      </div>
    </div>
  );
}
