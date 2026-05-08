
import { useRef, useEffect, useCallback } from "react";
import { useTimeline } from "@/hooks/useTimeline";
import {
  findActiveClip,
  getContentDuration,
  getSourceTimeForTimeline,
} from "@/utils/timeline";
import { motion, AnimatePresence } from "framer-motion";
import React, { useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Upload, MousePointerSquareDashed, Maximize, Volume2, VolumeX, Lock, Unlock, MonitorPlay, Settings2, RotateCcw, X, Maximize2, Minimize2, Copy, PictureInPicture2, SlidersHorizontal, Repeat2, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

const ReactPlayer = React.lazy(() => import("react-player"));

type CompactWindowSnapshot = {
  size: { width: number; height: number };
  position: { x: number; y: number };
  maximized: boolean;
  fullscreen: boolean;
};

const hasTauriIpc = () =>
  typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function" &&
  "__TAURI_METADATA__" in window;

export default function Canvas() {
  const { t } = useTranslation();
  const { 
    appMode, setAppMode, videoUrl, clips, zoom, posX, posY, playing, setPlaying, 
    currentTime, setCurrentTime, duration, setDuration, 
    setVideoFile, resolution, canvasScale, setCanvasScale, videoPath,
    isFullscreen, setIsFullscreen, colorCorrection, setColorCorrection, resetColorCorrection
  } = useTimeline();
  const playerRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [fsIdle, setFsIdle] = useState(false);
  const [fsFreeMode, setFsFreeMode] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [showImageControls, setShowImageControls] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [editorControlsHidden, setEditorControlsHidden] = useState(false);
  const [isCompactWindow, setIsCompactWindow] = useState(false);
  const [isWebCompactWindow, setIsWebCompactWindow] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsTransitionChainRef = useRef<Promise<void>>(Promise.resolve());
  const sampleLoadTokenRef = useRef(0);
  const hasNativeFullscreenRef = useRef<boolean | null>(null);
  const compactWindowSnapshotRef = useRef<CompactWindowSnapshot | null>(null);
  const activeTimelineClip = findActiveClip(clips, currentTime);
  const contentDuration = getContentDuration(clips);
  const playbackDuration = contentDuration > 0 ? contentDuration : duration;
  const isTimelineGap = clips.length > 0 && !activeTimelineClip && currentTime < contentDuration;

  const getNativeWindow = useCallback(async () => {
    if (!hasTauriIpc()) {
      hasNativeFullscreenRef.current = false;
      return null;
    }

    try {
      const { appWindow } = await import("@tauri-apps/api/window");
      hasNativeFullscreenRef.current = true;
      return appWindow;
    } catch {
      hasNativeFullscreenRef.current = false;
      return null;
    }
  }, []);

  const syncFullscreenState = useCallback(async () => {
    const appWindow = await getNativeWindow();
    if (appWindow) {
      const fs = await appWindow.isFullscreen();
      setIsFullscreen(fs);
      return fs;
    }
    const fs = !!document.fullscreenElement;
    setIsFullscreen(fs);
    return fs;
  }, [getNativeWindow, setIsFullscreen]);

  const runFullscreenTransition = useCallback(
    async (action: () => Promise<void>) => {
      const nextTransition = fsTransitionChainRef.current.then(async () => {
        useTimeline.getState().setFsTransitioning(true);
        setFullscreenError(null);
        try {
          await action();
          await syncFullscreenState();
        } catch (err) {
          console.error("Fullscreen transition failed:", err);
          setFullscreenError("No se pudo activar pantalla completa.");
          throw err;
        } finally {
          useTimeline.getState().setFsTransitioning(false);
        }
      });
      fsTransitionChainRef.current = nextTransition.catch(() => {});
      return nextTransition;
    },
    [syncFullscreenState, t]
  );

  const enterFullscreenNative = useCallback(async () => {
    setFsFreeMode(false);
    return runFullscreenTransition(async () => {
      const appWindow = await getNativeWindow();
      if (appWindow) {
        const alreadyFs = await appWindow.isFullscreen();
        if (alreadyFs) return;
        await appWindow.setDecorations(false);
        await appWindow.setFullscreen(true);
        return;
      }
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    });
  }, [getNativeWindow, runFullscreenTransition]);

  const exitFullscreenNative = useCallback(async () => {
    return runFullscreenTransition(async () => {
      const appWindow = await getNativeWindow();
      if (appWindow) {
        const currentlyFs = await appWindow.isFullscreen();
        if (currentlyFs) {
          await appWindow.setFullscreen(false);
        }
        await appWindow.setDecorations(true);
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    });
  }, [getNativeWindow, runFullscreenTransition]);

  const toggleFullscreenMode = useCallback(async () => {
    if (compactWindowSnapshotRef.current) {
      compactWindowSnapshotRef.current = null;
      setIsCompactWindow(false);
      setIsWebCompactWindow(false);
      try {
        const { appWindow } = await import("@tauri-apps/api/window");
        await appWindow.setAlwaysOnTop(false);
      } catch (err) {
        console.error("Failed to clear compact window state:", err);
      }
    }

    if (isFullscreen) {
      setAppMode("editor");
      await exitFullscreenNative();
    } else {
      setAppMode("player");
      await enterFullscreenNative();
    }
  }, [enterFullscreenNative, exitFullscreenNative, isFullscreen, setAppMode]);

  const restoreCompactWindowMode = useCallback(async () => {
    const snapshot = compactWindowSnapshotRef.current;
    if (!snapshot) return;

    try {
      const { appWindow, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setDecorations(!snapshot.fullscreen);
      if (snapshot.fullscreen) {
        await appWindow.setFullscreen(true);
        setIsFullscreen(true);
      } else {
        if (snapshot.maximized) {
          await appWindow.maximize();
        } else {
          await appWindow.setSize(new PhysicalSize(snapshot.size.width, snapshot.size.height));
          await appWindow.setPosition(new PhysicalPosition(snapshot.position.x, snapshot.position.y));
        }
      }
    } catch (err) {
      console.error("Failed to restore compact window mode:", err);
    } finally {
      compactWindowSnapshotRef.current = null;
      setIsCompactWindow(false);
      setIsWebCompactWindow(false);
    }
  }, [setIsFullscreen]);

  const toggleCompactWindowMode = useCallback(async () => {
    if (isWebCompactWindow) {
      setIsWebCompactWindow(false);
      setIsCompactWindow(false);
      return;
    }

    if (compactWindowSnapshotRef.current) {
      await restoreCompactWindowMode();
      return;
    }

    try {
      if (!hasTauriIpc()) {
        setAppMode("player");
        setFsFreeMode(false);
        setIsFullscreen(false);
        setIsCompactWindow(true);
        setIsWebCompactWindow(true);
        setFullscreenError(null);
        return;
      }

      const {
        appWindow,
        currentMonitor,
        PhysicalPosition,
        PhysicalSize,
      } = await import("@tauri-apps/api/window");

      const [size, position, maximized, fullscreen] = await Promise.all([
        appWindow.innerSize(),
        appWindow.outerPosition(),
        appWindow.isMaximized(),
        appWindow.isFullscreen(),
      ]);

      compactWindowSnapshotRef.current = {
        size: { width: size.width, height: size.height },
        position: { x: position.x, y: position.y },
        maximized,
        fullscreen,
      };

      if (fullscreen) {
        await appWindow.setFullscreen(false);
      }
      if (maximized) {
        await appWindow.unmaximize();
      }

      const monitor = await currentMonitor();
      const monitorPosition = monitor?.position ?? { x: 0, y: 0 };
      const monitorSize = monitor?.size ?? {
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      };
      const compactWidth = 420;
      const compactHeight = 260;
      const margin = 24;

      await appWindow.setDecorations(true);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setSize(new PhysicalSize(compactWidth, compactHeight));
      await appWindow.setPosition(
        new PhysicalPosition(
          Math.max(monitorPosition.x, monitorPosition.x + monitorSize.width - compactWidth - margin),
          Math.max(monitorPosition.y, monitorPosition.y + monitorSize.height - compactHeight - margin)
        )
      );
      await appWindow.setFocus();

      setAppMode("player");
      setFsFreeMode(false);
      setIsFullscreen(false);
      setIsCompactWindow(true);
    } catch (err) {
      console.error("Failed to enter compact window mode:", err);
      compactWindowSnapshotRef.current = null;

      if (!hasTauriIpc()) {
        setAppMode("player");
        setFsFreeMode(false);
        setIsFullscreen(false);
        setIsCompactWindow(true);
        setIsWebCompactWindow(true);
        setFullscreenError(null);
        return;
      }

      setFullscreenError("No se pudo activar ventana pequena.");
    }
  }, [isWebCompactWindow, restoreCompactWindowMode, setAppMode, setIsFullscreen]);

  const closePlayerMode = useCallback(() => {
    if (compactWindowSnapshotRef.current) {
      restoreCompactWindowMode().catch(() => {});
    }
    setIsCompactWindow(false);
    setIsWebCompactWindow(false);
    setAppMode("editor");
    setFsFreeMode(false);
    if (isFullscreen) {
      exitFullscreenNative().catch(() => {});
    }
  }, [exitFullscreenNative, isFullscreen, restoreCompactWindowMode, setAppMode]);

  // Listen for fullscreen and maximize changes
  useEffect(() => {
    const handler = async () => {
      if (hasNativeFullscreenRef.current) {
        await syncFullscreenState();
        return;
      }
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) {
        useTimeline.getState().setAppMode("editor");
        setFsIdle(false);
        setFsFreeMode(false);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      }
    };
    document.addEventListener('fullscreenchange', handler);

    // Tauri specific window listeners
    const setupTauriListeners = async () => {
      let unlistenResize: () => void;
      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        setIsMaximized(await appWindow.isMaximized());
        
        hasNativeFullscreenRef.current = true;
        // Listen for window resize to sync fullscreen/maximized state
        unlistenResize = await appWindow.onResized(async () => {
          if (useTimeline.getState().fsTransitioning) return;

          setIsMaximized(await appWindow.isMaximized());
          const fs = await syncFullscreenState();
          
          if (!fs) {
            // Restore decorations when exiting FS
            await appWindow.setDecorations(true);
            useTimeline.getState().setAppMode("editor");
            setFsIdle(false);
            setFsFreeMode(false);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
          } else {
            // Ensure decorations stay hidden in FS
            await appWindow.setDecorations(false);
          }
        });

        // Sync initial native fullscreen state
        await syncFullscreenState();

        return () => {
          if (unlistenResize) unlistenResize();
        };
      } catch (err) {
        console.error("Tauri window listeners failed:", err);
      }
    };
    const cleanupTauri = setupTauriListeners();

    return () => {
      document.removeEventListener('fullscreenchange', handler);
      cleanupTauri.then(cleanup => cleanup?.());
    };
  }, [setIsFullscreen, syncFullscreenState]);

  // Fullscreen idle timer: hide controls after 4s of no mouse movement
  const resetIdleTimer = useCallback(() => {
    setFsIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setFsIdle(true), 4000);
  }, []);

  const isPlayerSurface = isFullscreen || appMode === "player";

  useEffect(() => {
    if (!isPlayerSurface) return;
    // Start the timer when entering fullscreen
    resetIdleTimer();

    const onMove = () => resetIdleTimer();
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isPlayerSurface, resetIdleTimer]);

  // Editor controls stay visible unless the user explicitly hides them.
  // Player/fullscreen controls still disappear after idle time.
  const showControls = isPlayerSurface ? !fsIdle : !editorControlsHidden;

  useEffect(() => {
    if (!isPlayerSurface) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePlayerMode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePlayerMode, isPlayerSurface]);

  // Auto-load sample video on first mount if no video is loaded
  useEffect(() => {
    if (videoUrl) return; // Already has a video
    sampleLoadTokenRef.current += 1;
    const token = sampleLoadTokenRef.current;
    const loadSample = async () => {
      try {
        const res = await fetch('/v-1.mp4');
        if (!res.ok) return;
        const blob = await res.blob();
        const file = new File([blob], 'v-1.mp4', { type: 'video/mp4' });
        const url = URL.createObjectURL(file);
        const latest = useTimeline.getState();
        if (token !== sampleLoadTokenRef.current || latest.videoUrl) {
          URL.revokeObjectURL(url);
          return;
        }
        setVideoFile(file, url);
      } catch {
        // Sample not available, that's fine
      }
    };
    loadSample();
    return () => {
      sampleLoadTokenRef.current += 1;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-Fullscreen on video load from OS path
  const lastLoadPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (videoPath && videoPath !== lastLoadPathRef.current) {
      lastLoadPathRef.current = videoPath;
      if (!isFullscreen && appMode === "player") {
        enterFullscreenNative().catch(() => {});
      }
    }
  }, [videoPath, isFullscreen, appMode, enterFullscreenNative]);
  
  // Keep external scrubs synchronized with the edited timeline.
  useEffect(() => {
    if (!playerRef.current || clips.length === 0) return;

    const activeClip = findActiveClip(clips, currentTime);

    if (activeClip) {
      const localTime = getSourceTimeForTimeline(activeClip, currentTime);
      
      const currentInternalTime = playerRef.current.getCurrentTime();
      if (Math.abs(currentInternalTime - localTime) > 0.35) {
        playerRef.current.seekTo(localTime, "seconds");
      }
    } else {
      if (playing && currentTime >= getContentDuration(clips)) {
        if (loopPlayback) {
          setCurrentTime(0);
          return;
        }
        setPlaying(false);
      }
    }
  }, [currentTime, clips, playing, loopPlayback, setCurrentTime, setPlaying]);

  // The edited timeline is the master playback clock. ReactPlayer only renders
  // the source frame that corresponds to the current timeline time.
  useEffect(() => {
    if (!playing || clips.length === 0) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const state = useTimeline.getState();
      const nextTime = Math.min(state.currentTime + elapsed, getContentDuration(state.clips));
      state.setCurrentTime(nextTime);
      if (nextTime >= getContentDuration(state.clips)) {
        if (loopPlayback) {
          state.setCurrentTime(0);
          playerRef.current?.seekTo(0, "seconds");
          frame = requestAnimationFrame(tick);
          return;
        }
        state.setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clips.length, loopPlayback, playing]);

  // Force actual pause on internal player to prevent ghost audio
  useEffect(() => {
    const internalPlayer = playerRef.current?.getInternalPlayer();
    if (!internalPlayer) return;

    if (playing) {
      // Small delay to ensure seek has settled if we just started
      const t = setTimeout(() => {
        if (internalPlayer.paused) internalPlayer.play?.().catch(() => {});
      }, 50);
      return () => clearTimeout(t);
    } else {
      if (!internalPlayer.paused) internalPlayer.pause?.();
    }
  }, [playing, videoUrl]);

  const handleProgress = useCallback((state: any) => {
    if (!playing || clips.length === 0) return;
    const activeClip = findActiveClip(clips, currentTime);
    if (!activeClip) return;

    const sourceTime = state.playedSeconds;
    const expectedSourceTime = getSourceTimeForTimeline(activeClip, currentTime);
    if (Math.abs(sourceTime - expectedSourceTime) > 0.45) {
      playerRef.current?.seekTo(expectedSourceTime, "seconds");
    }
  }, [playing, clips, currentTime]);

  const scale = zoom / 100;
  const translateX = (posX - 50) * -1;
  const translateY = (posY - 50) * -1;

  // In player mode: ignore transforms, video fills screen unless unlocked.
  const isFixedMode = isPlayerSurface && !fsFreeMode;
  const effectiveScale = isFixedMode ? 1 : scale;
  const effectiveTranslateX = isFixedMode ? 0 : translateX;
  const effectiveTranslateY = isFixedMode ? 0 : translateY;
  const effectiveCanvasScale = isFixedMode ? 1 : canvasScale;
  const previewFilter = colorCorrection.enabled
    ? [
        `brightness(${1 + colorCorrection.brightness / 100})`,
        `contrast(${1 + colorCorrection.contrast / 100})`,
        `saturate(${1 + colorCorrection.saturation / 100})`,
      ].join(" ")
    : undefined;
  const shadowLiftOpacity = colorCorrection.enabled && colorCorrection.shadows > 0
    ? Math.min(colorCorrection.shadows / 120, 0.42)
    : 0;
  const shadowCrushOpacity = colorCorrection.enabled && colorCorrection.shadows < 0
    ? Math.min(Math.abs(colorCorrection.shadows) / 140, 0.36)
    : 0;
  const temperatureOpacity = colorCorrection.enabled
    ? Math.min(Math.abs(colorCorrection.temperature) / 120, 0.36)
    : 0;
  const temperatureColor = colorCorrection.temperature >= 0
    ? "rgba(255, 170, 85, 1)"
    : "rgba(95, 150, 255, 1)";
  const applyColorCorrection = (updates: Partial<typeof colorCorrection>) => {
    setColorCorrection({ enabled: true, ...updates });
  };
  const colorPresets = [
    { label: "Normal", values: { enabled: false, brightness: 0, contrast: 0, saturation: 0, shadows: 0, temperature: 0 } },
    { label: "Claro", values: { enabled: true, brightness: 8, contrast: 6, saturation: 4, shadows: 18, temperature: 2 } },
    { label: "Vivo", values: { enabled: true, brightness: 3, contrast: 12, saturation: 18, shadows: 8, temperature: 4 } },
    { label: "Cine", values: { enabled: true, brightness: -2, contrast: 10, saturation: -4, shadows: 12, temperature: -5 } },
  ];

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
    const newTime = Math.max(0, Math.min(currentTime + amount, playbackDuration));
    setCurrentTime(newTime);
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Prevent zooming the actual browser window
    if (e.ctrlKey || e.metaKey) {
       e.preventDefault();
    }

    if (isPlayerSurface) {
      e.preventDefault();
    }

    if (isPlayerSurface && !fsFreeMode) {
      return;
    }
    
    // Scale up or down
    const delta = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(0.1, canvasScale + delta), 3.0);
    setCanvasScale(newScale);
  };

  const handleCompactWindowControl = useCallback((e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('[data-compact-window-button="true"]')) return;

    e.stopPropagation();
    e.preventDefault();
    toggleCompactWindowMode().catch(() => {});
  }, [toggleCompactWindowMode]);

  return (
    <div 
      ref={canvasContainerRef}
      className={`bg-[#121212] overflow-hidden backdrop-blur-none ${
        isWebCompactWindow
          ? 'fixed bottom-6 right-6 z-[100] w-[min(420px,calc(100vw-32px))] h-[260px] max-h-[calc(100vh-32px)] rounded-lg border border-white/15 shadow-2xl p-0'
          : `w-full h-full relative ${isFixedMode ? 'p-0' : 'p-4 sm:p-8 lg:p-12'}`
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onWheel={handleWheel}
      onPointerDownCapture={handleCompactWindowControl}
      onClickCapture={handleCompactWindowControl}
      onDoubleClick={() => {
        if (!isFullscreen) {
          setAppMode("player");
          enterFullscreenNative().catch(() => {});
        }
      }}
      onMouseMove={isPlayerSurface ? resetIdleTimer : undefined}
      style={{ cursor: isPlayerSurface && fsIdle && !isWebCompactWindow ? 'none' : undefined }}
    >
      <div className="w-full h-full relative" style={{ containerType: 'size' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          {videoUrl ? (
          <div 
            className={`w-full h-full relative flex flex-col items-center justify-center ${isFixedMode ? 'p-0' : 'p-[2vmin]'}`}
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
                className="w-full h-full flex items-center justify-center origin-center relative"
              >
                <React.Suspense fallback={<div className="w-full h-full bg-black/50 flex items-center justify-center animate-pulse"><MonitorPlay className="w-12 h-12 text-white/20" /></div>}>
                  <ReactPlayer
                    ref={playerRef}
                    url={videoUrl}
                    width="100%"
                    height="100%"
                    playing={playing && !!activeTimelineClip}
                    volume={volume}
                    muted={muted}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      // Ignore technical pauses caused by timeline gaps; the timeline clock keeps running.
                      if (playing && !isTimelineGap) setPlaying(false);
                    }}
                    onDuration={(d: number) => setDuration(d)}
                    onProgress={handleProgress}
                    onError={() => setPlayerError("No se pudo cargar el video.")}
                    progressInterval={100}
                    style={{
                      objectFit: isFixedMode ? 'contain' : 'contain',
                      opacity: isTimelineGap ? 0 : 1,
                      filter: previewFilter,
                    }}
                  />
                </React.Suspense>
                {colorCorrection.enabled && (shadowLiftOpacity > 0 || shadowCrushOpacity > 0 || temperatureOpacity > 0) && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {shadowLiftOpacity > 0 && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: "rgba(255,255,255,1)",
                          mixBlendMode: "screen",
                          opacity: shadowLiftOpacity,
                        }}
                      />
                    )}
                    {shadowCrushOpacity > 0 && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: "rgba(0,0,0,1)",
                          mixBlendMode: "multiply",
                          opacity: shadowCrushOpacity,
                        }}
                      />
                    )}
                    {temperatureOpacity > 0 && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: temperatureColor,
                          mixBlendMode: "soft-light",
                          opacity: temperatureOpacity,
                        }}
                      />
                    )}
                  </div>
                )}
              </motion.div>
            </motion.div>

            {/* Fullscreen Mode Toggle & Window Controls (top-right) */}
            <AnimatePresence>
              {showControls && (
                <div className="absolute top-4 sm:top-6 right-4 sm:right-6 left-4 sm:left-6 z-[80] flex items-center justify-between pointer-events-none">
                  {/* Left Controls (Player mode only) */}
                  <div className="flex items-center gap-2 pointer-events-auto">
                    {isPlayerSurface && (
                      <motion.button
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        onClick={(e) => { e.stopPropagation(); setFsFreeMode(!fsFreeMode); }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="w-10 h-10 flex items-center justify-center bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-white/70 hover:text-white hover:bg-black/80 transition-all shadow-xl active:scale-90"
                        title={fsFreeMode ? "Bloquear tamano" : "Desbloquear tamano"}
                        aria-label={fsFreeMode ? "Bloquear tamano" : "Desbloquear tamano"}
                        aria-pressed={fsFreeMode}
                      >
                        {fsFreeMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      </motion.button>
                    )}
                  </div>

                  {/* Right Window Controls (Minimize, Window Mode, Close) */}
                  {isPlayerSurface && (
                    <motion.div
                      initial={{ opacity: 0, x: 10, y: -10 }}
                      animate={{ opacity: 1, x: 0, y: 0 }}
                      exit={{ opacity: 0, x: 10, y: -10 }}
                      className="flex items-center gap-2 pointer-events-auto bg-black/20 p-1 rounded-full backdrop-blur-sm border border-white/5"
                    >
                      {/* Compact Window Button */}
                      <button
                        data-compact-window-button="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          toggleCompactWindowMode().catch(() => {});
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          toggleCompactWindowMode().catch(() => {});
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className={`p-2 sm:p-2.5 bg-black/40 hover:bg-zinc-700/80 backdrop-blur-md rounded-full text-white/70 hover:text-white transition-all shadow-xl border active:scale-90 ${
                          isCompactWindow ? 'border-blue-400/60 text-blue-200 shadow-blue-500/20' : 'border-white/10'
                        }`}
                        title={isCompactWindow ? "Restaurar ventana" : "Ventana pequena"}
                        aria-label={isCompactWindow ? "Restaurar ventana" : "Ventana pequena"}
                        aria-pressed={isCompactWindow}
                      >
                        <PictureInPicture2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>

                      {/* Minimize Button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const { appWindow } = await import('@tauri-apps/api/window');
                            await appWindow.minimize();
                          } catch (err) {
                            console.error("Failed to minimize window:", err);
                          }
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="p-2 sm:p-2.5 bg-black/40 hover:bg-zinc-700/80 backdrop-blur-md rounded-full text-white/70 hover:text-white transition-all shadow-xl border border-white/10 active:scale-90"
                        title={t('minimize_app')}
                      >
                        <Minimize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>

                      {/* Window Mode Toggle */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            if (compactWindowSnapshotRef.current) {
                              await restoreCompactWindowMode();
                            }
                            if (isFullscreen) {
                              await exitFullscreenNative();
                            }
                            setAppMode("editor");
                            const { appWindow } = await import('@tauri-apps/api/window');
                            await appWindow.toggleMaximize();
                            // Sync state
                            setIsMaximized(await appWindow.isMaximized());
                          } catch (err) {
                            console.error("Failed to toggle window mode:", err);
                          }
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="p-2 sm:p-2.5 bg-black/40 hover:bg-zinc-700/80 backdrop-blur-md rounded-full text-white/70 hover:text-white transition-all shadow-xl border border-white/10 active:scale-90"
                        title={isMaximized ? 'Restaurar' : t('window_mode')}
                      >
                        {isMaximized ? <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                      </button>

                      {/* Close Player Button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          closePlayerMode();
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="p-2 sm:p-2.5 bg-black/40 hover:bg-red-500/80 backdrop-blur-md rounded-full text-white/70 hover:text-white transition-all shadow-xl border border-white/10 group active:scale-90"
                        title="Cerrar reproductor"
                      >
                        <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform group-hover:rotate-90" />
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </AnimatePresence>
            
            {!isPlayerSurface && editorControlsHidden && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditorControlsHidden(false);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 right-4 z-50 h-9 px-3 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 text-white/75 hover:text-white hover:bg-black/85 flex items-center gap-2 shadow-xl"
                title="Mostrar controles"
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline text-xs font-medium">Controles</span>
              </button>
            )}

            {/* Player Controls */}
            <AnimatePresence>
              {showControls && (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 18 }}
                  className={`absolute bottom-0 left-0 right-0 z-50 pointer-events-none ${isFullscreen ? 'px-6 sm:px-10 pb-7 pt-24' : 'px-4 sm:px-7 pb-5 pt-20'} bg-gradient-to-t from-black/80 via-black/35 to-transparent`}
                >
                  <div
                    className="mb-4 w-full pointer-events-auto"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div 
                      className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group relative hover:h-2 transition-all"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const el = e.currentTarget;
                        const updateTime = (clientEx: number) => {
                          const rect = el.getBoundingClientRect();
                          const percent = Math.max(0, Math.min(1, (clientEx - rect.left) / rect.width));
                          setCurrentTime(percent * playbackDuration);
                        };
                        updateTime(e.clientX);

                        const onMove = (me: PointerEvent) => {
                          me.preventDefault();
                          updateTime(me.clientX);
                        };
                        const onUp = () => {
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                        };
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                      }}
                    >
                      <div 
                        className="h-full bg-blue-500 rounded-full relative pointer-events-none shadow-[0_0_18px_rgba(59,130,246,0.55)]"
                        style={{ width: `${playbackDuration > 0 ? (Math.min(currentTime, playbackDuration) / playbackDuration) * 100 : 0}%` }}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow scale-0 group-hover:scale-100 transition-transform -mr-1.5" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
                    {/* Left Utility Controls */}
                    <div className="justify-self-start flex items-center gap-2 pointer-events-auto min-w-0">
                      <div className="h-10 flex items-center gap-1.5 bg-black/65 backdrop-blur-md border border-white/10 rounded-lg px-2 group max-w-[150px] sm:max-w-none shadow-xl"
                         onClick={(e) => e.stopPropagation()}
                         onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setMuted(!muted)}
                          className="text-white/70 hover:text-white transition-colors shrink-0"
                          title={muted || volume === 0 ? "Activar audio" : "Silenciar"}
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
                          className="w-20 sm:w-28"
                        />
                      </div>

                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setCurrentTime(0);
                          setPlaying(true);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="w-10 h-10 rounded-lg bg-black/65 backdrop-blur-md border border-white/10 text-white/70 hover:text-white hover:bg-black/85 flex items-center justify-center transition-all shrink-0 shadow-xl"
                        title={t('restart')}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLoopPlayback((value) => !value);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className={`w-10 h-10 rounded-lg bg-black/65 backdrop-blur-md border text-white/70 hover:text-white hover:bg-black/85 flex items-center justify-center transition-all shrink-0 shadow-xl ${
                          loopPlayback ? 'border-blue-400/60 text-blue-200 shadow-blue-500/20' : 'border-white/10'
                        }`}
                        title={loopPlayback ? "Repeticion activada" : "Repetir video"}
                      >
                        <Repeat2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Center Transport Controls */}
                    <div className="justify-self-center h-14 bg-black/70 backdrop-blur-xl border border-white/10 text-white px-5 rounded-full flex items-center gap-5 shadow-2xl pointer-events-auto">
                      <button onClick={() => skipTime(-5)} className="text-white/75 hover:text-blue-300 transition-colors" title="-5 Seconds">
                        <SkipBack className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setPlaying(!playing)} 
                        className="bg-blue-600 hover:bg-blue-500 text-white w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg hover:shadow-blue-500/50 active:scale-95"
                      >
                        {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
                      </button>
                      <button onClick={() => skipTime(5)} className="text-white/75 hover:text-blue-300 transition-colors" title="+5 Seconds">
                        <SkipForward className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Right Action Controls */}
                    <div className="justify-self-end flex items-center gap-2 pointer-events-auto min-w-0">
                    {!isPlayerSurface && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditorControlsHidden(true);
                          setShowImageControls(false);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="w-10 h-10 rounded-lg bg-black/65 backdrop-blur-md border border-white/10 text-white/70 hover:text-white hover:bg-black/85 flex items-center justify-center transition-all shrink-0 shadow-xl"
                        title="Ocultar controles"
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    )}

                    <div
                      className="relative"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                    <button
                      onClick={() => setShowImageControls((v) => !v)}
                      className={`h-10 px-3 rounded-lg bg-black/65 backdrop-blur-md border text-white/70 hover:text-white hover:bg-black/85 flex items-center justify-center transition-all shadow-xl ${
                        colorCorrection.enabled ? 'border-blue-400/60 text-blue-200' : 'border-white/10'
                      }`}
                      title="Mejorar imagen"
                    >
                      <SlidersHorizontal className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline text-xs font-medium">Imagen</span>
                    </button>

                    <AnimatePresence>
                      {showImageControls && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.96 }}
                          className="absolute right-0 bottom-12 w-[min(320px,calc(100vw-24px))] rounded-lg border border-white/10 bg-black/85 backdrop-blur-xl shadow-2xl p-4 text-white"
                        >
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                              <div className="text-sm font-semibold">Mejorar imagen</div>
                              <div className="text-[11px] text-white/50">Preview rapido y export opcional</div>
                            </div>
                            <button
                              onClick={() => setColorCorrection({ enabled: !colorCorrection.enabled })}
                              className={`relative w-9 h-5 rounded-full transition-colors ${colorCorrection.enabled ? 'bg-blue-500' : 'bg-white/20'}`}
                              title={colorCorrection.enabled ? "Desactivar" : "Activar"}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${colorCorrection.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </button>
                          </div>

                          <div className="grid grid-cols-4 gap-1.5 mb-4">
                            {colorPresets.map((preset) => (
                              <button
                                key={preset.label}
                                onClick={() => setColorCorrection(preset.values)}
                                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>

                          {[
                            ["Brillo", "brightness", -50, 50],
                            ["Sombras", "shadows", -50, 50],
                            ["Contraste", "contrast", -50, 50],
                            ["Saturacion", "saturation", -50, 50],
                            ["Temperatura", "temperature", -50, 50],
                          ].map(([label, key, min, max]) => {
                            const value = colorCorrection[key as keyof typeof colorCorrection] as number;
                            return (
                              <label key={key} className="block mb-3">
                                <div className="flex items-center justify-between text-xs mb-1.5">
                                  <span className="text-white/75">{label}</span>
                                  <span className="font-mono text-white/50">{value.toFixed(0)}</span>
                                </div>
                                <input
                                  type="range"
                                  min={min as number}
                                  max={max as number}
                                  step={1}
                                  value={value}
                                  onChange={(e) => applyColorCorrection({ [key as string]: Number(e.target.value) })}
                                  className="w-full accent-blue-500"
                                />
                              </label>
                            );
                          })}

                          <button
                            onClick={resetColorCorrection}
                            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            Reset imagen
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    </div>

                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (appMode === "player") {
                          setAppMode("editor");
                          if (isFullscreen) {
                            exitFullscreenNative().catch(() => {});
                          }
                        } else {
                          toggleFullscreenMode().catch(() => {});
                        }
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="h-10 px-3 sm:px-4 rounded-lg bg-black/65 backdrop-blur-md border border-white/10 text-white/70 hover:text-white hover:bg-black/85 flex items-center justify-center transition-all shrink-0 shadow-xl"
                      title={appMode === "player" ? 'Editar' : 'Pantalla Completa'}
                    >
                      {appMode === "player" ? <Settings2 className="w-4 h-4 sm:mr-2" /> : <Maximize className="w-4 h-4 sm:mr-2" />}
                      <span className="hidden md:inline text-xs font-medium">
                        {appMode === "player" ? 'Editar' : 'Pantalla Completa'}
                      </span>
                    </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {(playerError || fullscreenError) && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] bg-red-500/90 text-white text-xs px-3 py-2 rounded-md shadow-lg">
                {fullscreenError || playerError}
              </div>
            )}
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
