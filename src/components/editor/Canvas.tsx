
import { useRef, useEffect, useCallback } from "react";
import { useTimeline } from "@/hooks/useTimeline";
import {
  findActiveClip,
  getContentDuration,
  getSourceTimeForTimeline,
} from "@/utils/timeline";
import { motion, AnimatePresence } from "framer-motion";
import React, { useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Upload, MousePointerSquareDashed, Maximize, Volume2, VolumeX, Lock, Unlock, MonitorPlay, Settings2, RotateCcw, X, Copy, PictureInPicture2, SlidersHorizontal, Repeat2, Eye, EyeOff, Columns2, Trash2, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { analyzeVideoImage, type AnalysisProgress } from "@/utils/videoAnalyzer";

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

const SCREENSHOT_FOLDER_NAME = "Capturas de pantalla de Flowuana";
const SCREENSHOT_SOUND_URL = "/sounds/camera_fotos.mp3";

type ScreenshotStatus = {
  type: "success" | "error";
  message: string;
  percent?: number;
  queued?: number;
};

type ScreenshotJob = {
  filename: string;
  height: number;
  video: HTMLVideoElement;
  width: number;
};

const formatScreenshotTimestamp = (date = new Date()) => {
  const pad = (value: number, size = 2) => value.toString().padStart(size, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-") + `-${pad(date.getMilliseconds(), 3)}`;
};

const getVideoElementFromPlayer = (player: any): HTMLVideoElement | null => {
  const internalPlayer = player?.getInternalPlayer?.();
  if (internalPlayer instanceof HTMLVideoElement) return internalPlayer;
  if (internalPlayer?.player instanceof HTMLVideoElement) return internalPlayer.player;
  return null;
};

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("No se pudo generar la imagen PNG."));
          return;
        }
        resolve(blob);
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });

const stopScreenshotControlEvent = (event: React.SyntheticEvent) => {
  event.stopPropagation();
  event.preventDefault();
  if ("nativeEvent" in event) {
    (event.nativeEvent as Event).stopPropagation();
  }
};

const downloadScreenshotInBrowser = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function Canvas() {
  const { t } = useTranslation();
  const { 
    appMode, setAppMode, videoUrl, clips, zoom, posX, posY, playing, setPlaying, 
    currentTime, setCurrentTime, duration, setDuration, 
    setVideoFile, resolution, canvasScale, setCanvasScale, videoPath,
    isFullscreen, setIsFullscreen, colorCorrection, setColorCorrection, resetColorCorrection, imageAnalysis, setImageAnalysis,
    showOriginalPreview, setShowOriginalPreview
  } = useTimeline();
  const playerRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imageControlsRef = useRef<HTMLDivElement>(null);
  const screenClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotSoundRef = useRef<HTMLAudioElement | null>(null);
  const screenshotSequenceRef = useRef(0);
  const screenshotFsApiRef = useRef<Promise<any> | null>(null);
  const screenshotDirectoryReadyRef = useRef<Promise<void> | null>(null);
  const screenshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotQueueRef = useRef<ScreenshotJob[]>([]);
  const screenshotProcessingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [, setIsMaximized] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [fsIdle, setFsIdle] = useState(false);
  const [fsFreeMode, setFsFreeMode] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [showImageControls, setShowImageControls] = useState(false);
  const [screenshotModeEnabled, setScreenshotModeEnabled] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus | null>(null);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [editorControlsHidden, setEditorControlsHidden] = useState(false);
  const [isCompactWindow, setIsCompactWindow] = useState(false);
  const [isWebCompactWindow, setIsWebCompactWindow] = useState(false);
  const [imageScanProgress, setImageScanProgress] = useState<AnalysisProgress | null>(null);
  const imageScanPercent = imageScanProgress
    ? Math.round((imageScanProgress.current / Math.max(1, imageScanProgress.total)) * 100)
    : 0;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsTransitionChainRef = useRef<Promise<void>>(Promise.resolve());
  const sampleLoadTokenRef = useRef(0);
  const hasNativeFullscreenRef = useRef<boolean | null>(null);
  const compactWindowSnapshotRef = useRef<CompactWindowSnapshot | null>(null);
  const isChangingWindowStateRef = useRef(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareVideoUrl, setCompareVideoUrl] = useState<string | null>(null);
  const [compareMuted, setCompareMuted] = useState(true);
  const comparePlayerRef = useRef<any>(null);
  const compareFileInputRef = useRef<HTMLInputElement>(null);
  const activeTimelineClip = findActiveClip(clips, currentTime);
  const contentDuration = getContentDuration(clips);
  const playbackDuration = contentDuration > 0 ? contentDuration : duration;
  const isTimelineGap = clips.length > 0 && !activeTimelineClip && currentTime < contentDuration;

  useEffect(() => {
    setPlayerError(null);
    setScreenshotCount(0);
    screenshotSequenceRef.current = 0;
    screenshotQueueRef.current = [];
    setScreenshotStatus(null);
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (screenshotStatusTimerRef.current) {
        clearTimeout(screenshotStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const audio = new Audio(SCREENSHOT_SOUND_URL);
    audio.preload = "auto";
    audio.volume = 0.75;
    screenshotSoundRef.current = audio;

    return () => {
      screenshotSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showImageControls) return;

    const closeImageControlsOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && imageControlsRef.current?.contains(target)) return;
      setShowImageControls(false);
    };

    document.addEventListener("pointerdown", closeImageControlsOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeImageControlsOnOutsidePress);
  }, [showImageControls]);

  useEffect(() => {
    return () => {
      if (screenClickTimerRef.current) clearTimeout(screenClickTimerRef.current);
    };
  }, []);

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

  const startWindowStateChange = useCallback(() => {
    isChangingWindowStateRef.current = true;
    setTimeout(() => {
      isChangingWindowStateRef.current = false;
    }, 600);
  }, []);

  const saveEditorSnapshot = useCallback(async () => {
    if (!hasTauriIpc()) return;
    try {
      const { appWindow } = await import("@tauri-apps/api/window");
      const [size, position, maximized] = await Promise.all([
        appWindow.innerSize(),
        appWindow.outerPosition(),
        appWindow.isMaximized(),
      ]);
      compactWindowSnapshotRef.current = {
        size: { width: size.width, height: size.height },
        position: { x: position.x, y: position.y },
        maximized,
        fullscreen: false,
      };
    } catch (err) {
      console.error("Failed to save editor snapshot:", err);
    }
  }, []);

  const handleCompareFileSelectClick = useCallback(() => {
    compareFileInputRef.current?.click();
  }, []);

  const handleCompareFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCompareVideoUrl((prev) => {
        if (prev && prev.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        return url;
      });
      setCompareMuted(true);
    }
  }, []);

  const clearCompareVideo = useCallback(() => {
    setCompareVideoUrl((prev) => {
      if (prev && prev.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setCompareMuted(true);
  }, []);

  const toggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      const next = !prev;
      if (!next) {
        setCompareVideoUrl((prevUrl) => {
          if (prevUrl && prevUrl.startsWith("blob:")) {
            URL.revokeObjectURL(prevUrl);
          }
          return null;
        });
        setCompareMuted(true);
      } else {
        setCurrentTime(0);
        setPlaying(false);
      }
      return next;
    });
  }, [setCurrentTime, setPlaying]);

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
    startWindowStateChange();
    setFsFreeMode(false);
    setIsCompactWindow(false);
    setIsWebCompactWindow(false);
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
  }, [getNativeWindow, runFullscreenTransition, startWindowStateChange]);

  const exitFullscreenNative = useCallback(async () => {
    startWindowStateChange();
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
  }, [getNativeWindow, runFullscreenTransition, startWindowStateChange]);

  const toggleFullscreenMode = useCallback(async () => {
    startWindowStateChange();
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
      await saveEditorSnapshot();
      setAppMode("player");
      await enterFullscreenNative();
    }
  }, [enterFullscreenNative, exitFullscreenNative, isFullscreen, setAppMode, saveEditorSnapshot, startWindowStateChange]);

  const restoreCompactWindowMode = useCallback(async () => {
    startWindowStateChange();
    const snapshot = compactWindowSnapshotRef.current;
    if (!snapshot) return;

    try {
      const { appWindow, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setDecorations(true);
      setAppMode("player");
      setFsFreeMode(false);
      if (snapshot.maximized) {
        await appWindow.maximize();
      } else {
        await appWindow.setSize(new PhysicalSize(snapshot.size.width, snapshot.size.height));
        await appWindow.setPosition(new PhysicalPosition(snapshot.position.x, snapshot.position.y));
      }
    } catch (err) {
      console.error("Failed to restore compact window mode:", err);
    } finally {
      compactWindowSnapshotRef.current = null;
      setIsCompactWindow(false);
      setIsWebCompactWindow(false);
    }
  }, [setAppMode, startWindowStateChange]);

  const toggleCompactWindowMode = useCallback(async () => {
    startWindowStateChange();
    if (isWebCompactWindow) {
      setIsWebCompactWindow(false);
      setIsCompactWindow(false);
      return;
    }

    if (compactWindowSnapshotRef.current && !isFullscreen) {
      await restoreCompactWindowMode();
      return;
    }

    try {
      if (!hasTauriIpc()) {
        setAppMode("player");
        setFsFreeMode(false);
        setShowImageControls(false);
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

      if (!compactWindowSnapshotRef.current) {
        await saveEditorSnapshot();
      }
      setAppMode("player");
      setFsFreeMode(false);
      setShowImageControls(false);
      setIsCompactWindow(true);

      const alreadyFs = await appWindow.isFullscreen();
      if (alreadyFs) {
        await appWindow.setFullscreen(false);
      }
      const alreadyMax = await appWindow.isMaximized();
      if (alreadyMax) {
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

      await appWindow.setDecorations(false);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setSize(new PhysicalSize(compactWidth, compactHeight));
      await appWindow.setPosition(
        new PhysicalPosition(
          Math.max(monitorPosition.x, monitorPosition.x + monitorSize.width - compactWidth - margin),
          Math.max(monitorPosition.y, monitorPosition.y + monitorSize.height - compactHeight - margin)
        )
      );
      await appWindow.setFocus();

      setIsFullscreen(false);
    } catch (err) {
      console.error("Failed to enter compact window mode:", err);
      // Solo limpiar el snapshot si falló el primer intento de entrar a compact window
      if (!isCompactWindow) {
        compactWindowSnapshotRef.current = null;
      }
      setIsCompactWindow(false);

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
  }, [isWebCompactWindow, isFullscreen, isCompactWindow, restoreCompactWindowMode, setAppMode, setIsFullscreen, saveEditorSnapshot, startWindowStateChange]);

  const maximizeCompactWindow = useCallback(async () => {
    startWindowStateChange();
    if (!isCompactWindow) return;

    try {
      if (hasTauriIpc()) {
        const { appWindow } = await import("@tauri-apps/api/window");
        await appWindow.setAlwaysOnTop(false);
      }
      // Conservar compactWindowSnapshotRef.current para poder volver al editor con el tamaño original
      setIsCompactWindow(false);
      setIsWebCompactWindow(false);
      setAppMode("player");
      setFsFreeMode(false);
      await enterFullscreenNative();
    } catch (err) {
      console.error("Failed to maximize compact player:", err);
      setFullscreenError("No se pudo maximizar el reproductor.");
    }
  }, [enterFullscreenNative, isCompactWindow, setAppMode, startWindowStateChange]);

  const closeCompactWindowToEditor = useCallback(async () => {
    startWindowStateChange();
    const snapshot = compactWindowSnapshotRef.current;
    compactWindowSnapshotRef.current = null;
    setIsCompactWindow(false);
    setIsWebCompactWindow(false);
    setAppMode("editor");
    setFsFreeMode(false);
    setIsFullscreen(false);

    if (!hasTauriIpc()) return;

    try {
      const { appWindow, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
      await appWindow.setAlwaysOnTop(false);
      if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
      }
      await appWindow.setDecorations(true);
      if (snapshot?.maximized) {
        await appWindow.maximize();
      } else if (snapshot) {
        await appWindow.setSize(new PhysicalSize(snapshot.size.width, snapshot.size.height));
        await appWindow.setPosition(new PhysicalPosition(snapshot.position.x, snapshot.position.y));
      }
    } catch (err) {
      console.error("Failed to close compact player:", err);
    }
  }, [setAppMode, setIsFullscreen, startWindowStateChange]);

  const closePlayerMode = useCallback(() => {
    startWindowStateChange();
    if (isCompactWindow || compactWindowSnapshotRef.current) {
      closeCompactWindowToEditor().catch(() => {});
      return;
    }
    setIsCompactWindow(false);
    setIsWebCompactWindow(false);
    setAppMode("editor");
    setFsFreeMode(false);
    if (isFullscreen) {
      exitFullscreenNative().catch(() => {});
    }
  }, [closeCompactWindowToEditor, exitFullscreenNative, isCompactWindow, isFullscreen, setAppMode, startWindowStateChange]);

  useEffect(() => {
    const handler = async () => {
      if (isChangingWindowStateRef.current) return;
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
          if (isChangingWindowStateRef.current) return;
          if (useTimeline.getState().fsTransitioning) return;

          setIsMaximized(await appWindow.isMaximized());
          const fs = await syncFullscreenState();
          
          if (!fs) {
            if (compactWindowSnapshotRef.current) {
              await appWindow.setDecorations(false);
              useTimeline.getState().setAppMode("player");
              setFsIdle(false);
              setFsFreeMode(false);
              return;
            }
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

  const isPlayerSurface = isFullscreen || isCompactWindow || appMode === "player";

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

  // Keep visitor video playhead and play/pause synchronized with the timeline clock.
  useEffect(() => {
    const video = comparePlayerRef.current;
    if (!video || !compareVideoUrl) return;

    try {
      if (playing) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    } catch (_) {}
  }, [playing, compareVideoUrl]);

  useEffect(() => {
    const video = comparePlayerRef.current;
    if (!video || !compareVideoUrl) return;

    try {
      const currentInternalTime = video.currentTime;
      if (Math.abs(currentInternalTime - currentTime) > 0.35) {
        video.currentTime = currentTime;
      }
    } catch (_) {}
  }, [currentTime, compareVideoUrl]);

  // Deactivate comparison mode if the window is resized to compact mode.
  useEffect(() => {
    if (isCompactWindow && compareMode) {
      setCompareMode(false);
      setCompareVideoUrl((prevUrl) => {
        if (prevUrl && prevUrl.startsWith("blob:")) {
          URL.revokeObjectURL(prevUrl);
        }
        return null;
      });
      setCompareMuted(true);
    }
  }, [isCompactWindow, compareMode]);

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

  const handlePlayerError = useCallback(() => {
    setPlayerError("No se pudo cargar este video.");
  }, []);

  const scale = zoom / 100;
  const translateX = (posX - 50) * -1;
  const translateY = (posY - 50) * -1;

  // In player mode: ignore transforms, video fills screen unless unlocked.
  const isFixedMode = isPlayerSurface && !fsFreeMode;
  const effectiveScale = isFixedMode ? 1 : scale;
  const effectiveTranslateX = isFixedMode ? 0 : translateX;
  const effectiveTranslateY = isFixedMode ? 0 : translateY;
  const effectiveCanvasScale = isFixedMode ? 1 : canvasScale;
  const previewColorEnabled = colorCorrection.enabled && !showOriginalPreview;
  const previewFilter = previewColorEnabled
    ? [
        `brightness(${1 + colorCorrection.brightness / 100})`,
        `contrast(${1 + colorCorrection.contrast / 100})`,
        `saturate(${1 + colorCorrection.saturation / 100})`,
      ].join(" ")
    : undefined;
  const shadowLiftOpacity = previewColorEnabled && colorCorrection.shadows > 0
    ? Math.min(colorCorrection.shadows / 120, 0.42)
    : 0;
  const shadowCrushOpacity = previewColorEnabled && colorCorrection.shadows < 0
    ? Math.min(Math.abs(colorCorrection.shadows) / 140, 0.36)
    : 0;
  const highlightLiftOpacity = previewColorEnabled && colorCorrection.highlights > 0
    ? Math.min(colorCorrection.highlights / 155, 0.34)
    : 0;
  const highlightRecoverOpacity = previewColorEnabled && colorCorrection.highlights < 0
    ? Math.min(Math.abs(colorCorrection.highlights) / 180, 0.28)
    : 0;
  const temperatureOpacity = previewColorEnabled
    ? Math.min(Math.abs(colorCorrection.temperature) / 120, 0.36)
    : 0;
  const temperatureColor = colorCorrection.temperature >= 0
    ? "rgba(255, 170, 85, 1)"
    : "rgba(95, 150, 255, 1)";
  const showScreenshotStatus = useCallback((status: ScreenshotStatus) => {
    setScreenshotStatus(status);
    if (screenshotStatusTimerRef.current) clearTimeout(screenshotStatusTimerRef.current);
    if (status.type === "error" || status.percent === undefined || status.percent >= 100) {
      screenshotStatusTimerRef.current = setTimeout(() => {
        setScreenshotStatus(null);
        screenshotStatusTimerRef.current = null;
      }, 1400);
    } else {
      screenshotStatusTimerRef.current = null;
    }
  }, []);
  const playScreenshotSound = useCallback(() => {
    const audio = screenshotSoundRef.current
      ? (screenshotSoundRef.current.cloneNode(true) as HTMLAudioElement)
      : new Audio(SCREENSHOT_SOUND_URL);
    audio.volume = 0.75;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);
  const getScreenshotFsApi = useCallback(() => {
    if (!screenshotFsApiRef.current) {
      screenshotFsApiRef.current = import("@tauri-apps/api/fs");
    }
    return screenshotFsApiRef.current;
  }, []);
  const ensureScreenshotDirectory = useCallback(async (fsApi: any) => {
    if (!screenshotDirectoryReadyRef.current) {
      screenshotDirectoryReadyRef.current = (async () => {
        const folderExists = await fsApi.exists(SCREENSHOT_FOLDER_NAME, { dir: fsApi.BaseDirectory.Document });
        if (!folderExists) {
          await fsApi.createDir(SCREENSHOT_FOLDER_NAME, { dir: fsApi.BaseDirectory.Document, recursive: true });
        }
      })().catch((error) => {
        screenshotDirectoryReadyRef.current = null;
        throw error;
      });
    }

    await screenshotDirectoryReadyRef.current;
  }, []);
  const processScreenshotQueue = useCallback(async () => {
    if (screenshotProcessingRef.current) return;
    screenshotProcessingRef.current = true;

    try {
      while (screenshotQueueRef.current.length > 0) {
        const job = screenshotQueueRef.current.shift();
        if (!job) continue;
        const queuedAfterCurrent = screenshotQueueRef.current.length;
        const queueLabel = queuedAfterCurrent > 0 ? ` En cola: ${queuedAfterCurrent}.` : "";

        const canvas = screenshotCanvasRef.current ?? document.createElement("canvas");
        screenshotCanvasRef.current = canvas;
        canvas.width = job.width;
        canvas.height = job.height;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          showScreenshotStatus({ type: "error", message: "No se pudo preparar la captura." });
          continue;
        }

        try {
          showScreenshotStatus({
            type: "success",
            message: `Procesando captura.${queueLabel}`,
            percent: 12,
            queued: queuedAfterCurrent,
          });

          context.globalCompositeOperation = "source-over";
          context.globalAlpha = 1;
          context.filter = "none";
          context.drawImage(job.video, 0, 0, canvas.width, canvas.height);
          showScreenshotStatus({
            type: "success",
            message: `Codificando PNG.${queueLabel}`,
            percent: 45,
            queued: queuedAfterCurrent,
          });

          const blob = await canvasToPngBlob(canvas);
          showScreenshotStatus({
            type: "success",
            message: `Guardando captura.${queueLabel}`,
            percent: 78,
            queued: queuedAfterCurrent,
          });

          if (hasTauriIpc()) {
            const fsApi = await getScreenshotFsApi();
            await ensureScreenshotDirectory(fsApi);
            await fsApi.writeBinaryFile(
              `${SCREENSHOT_FOLDER_NAME}/${job.filename}`,
              await blob.arrayBuffer(),
              { dir: fsApi.BaseDirectory.Document }
            );
          } else {
            downloadScreenshotInBrowser(blob, job.filename);
          }

          const pending = screenshotQueueRef.current.length;
          showScreenshotStatus({
            type: "success",
            message: pending > 0 ? `Captura guardada. Quedan ${pending}.` : "Captura guardada.",
            percent: 100,
            queued: pending,
          });
          setScreenshotCount((count) => count + 1);
        } catch (error) {
          console.error("No se pudo guardar la captura:", error);
          showScreenshotStatus({ type: "error", message: "No se pudo guardar una captura." });
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      screenshotProcessingRef.current = false;
    }
  }, [ensureScreenshotDirectory, getScreenshotFsApi, showScreenshotStatus]);
  const captureCurrentFrame = useCallback(() => {
    const video = getVideoElementFromPlayer(playerRef.current);
    if (!video || !activeTimelineClip || isTimelineGap) {
      showScreenshotStatus({ type: "error", message: "El video todavia no esta listo para capturar." });
      return;
    }

    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      showScreenshotStatus({ type: "error", message: "El video todavia no esta listo para capturar." });
      return;
    }

    screenshotSequenceRef.current += 1;
    const sequence = screenshotSequenceRef.current.toString().padStart(4, "0");
    screenshotQueueRef.current.push({
      filename: `Flowuana-captura-${formatScreenshotTimestamp()}-${sequence}.png`,
      height: video.videoHeight,
      video,
      width: video.videoWidth,
    });

    const pending = screenshotQueueRef.current.length;
    showScreenshotStatus({
      type: "success",
      message: pending > 1 ? `${pending} capturas en cola.` : "Captura en cola.",
      percent: screenshotProcessingRef.current ? undefined : 0,
      queued: pending,
    });
    void processScreenshotQueue();
  }, [activeTimelineClip, isTimelineGap, processScreenshotQueue, showScreenshotStatus]);
  const applyColorCorrection = (updates: Partial<typeof colorCorrection>) => {
    setShowOriginalPreview(false);
    setColorCorrection({ enabled: true, ...updates });
  };
  const applyColorPreset = (values: typeof colorCorrection) => {
    setShowOriginalPreview(false);
    setColorCorrection(values);
  };
  const scanVideoImage = async () => {
    if (!videoUrl || imageScanProgress) return;
    try {
      setImageScanProgress({ current: 0, total: 1, phase: "preparing", message: "Preparando lectura del video" });
      const analysis = await analyzeVideoImage({
        videoUrl,
        duration: clips[0]?.sourceDuration ?? duration,
        samples: 144,
        onProgress: setImageScanProgress,
      });
      setImageAnalysis(analysis);
    } catch (error) {
      console.error("No se pudo escanear la imagen:", error);
    } finally {
      setImageScanProgress(null);
    }
  };
  const colorPresets = [
    { label: "Normal", values: { enabled: false, brightness: 0, highlights: 0, contrast: 0, saturation: 0, shadows: 0, temperature: 0 } },
    { label: "Claro", values: { enabled: true, brightness: 8, highlights: 14, contrast: 6, saturation: 4, shadows: 18, temperature: 2 } },
    { label: "Vivo", values: { enabled: true, brightness: 3, highlights: 10, contrast: 12, saturation: 18, shadows: 8, temperature: 4 } },
    { label: "Cine", values: { enabled: true, brightness: -2, highlights: -8, contrast: 10, saturation: -4, shadows: 12, temperature: -5 } },
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

  const handleScreenClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (screenClickTimerRef.current) return;

    screenClickTimerRef.current = setTimeout(() => {
      screenClickTimerRef.current = null;
      const state = useTimeline.getState();
      state.setPlaying(!state.playing);
    }, 180);
  };

  const handleScreenDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (screenClickTimerRef.current) {
      clearTimeout(screenClickTimerRef.current);
      screenClickTimerRef.current = null;
    }
    if (isCompactWindow) {
      maximizeCompactWindow().catch(() => {});
      return;
    }
    if (isFullscreen) {
      closePlayerMode();
      return;
    }
    setAppMode("player");
    enterFullscreenNative().catch(() => {});
  };

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
      onMouseMove={isPlayerSurface ? resetIdleTimer : undefined}
      style={{ cursor: isPlayerSurface && fsIdle && !isWebCompactWindow ? 'none' : undefined }}
    >
      <div className="w-full h-full relative" style={{ containerType: 'size' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          {videoUrl ? (
          <div 
            className={`w-full h-full relative flex flex-col items-center justify-center ${isFixedMode ? 'p-0' : 'p-[2vmin]'}`}
          >
            {compareMode ? (
              <div className="w-full h-full flex flex-col md:flex-row gap-4 p-4 items-center justify-center pointer-events-auto">
                {/* Left: Original Video */}
                <div className="flex-1 w-full h-full flex flex-col items-center justify-center relative min-w-0">
                  <div className="text-xs font-semibold text-white/50 mb-1.5 self-start pl-12">Original</div>
                  <div
                    onClick={handleScreenClick}
                    onDoubleClick={handleScreenDoubleClick}
                    className={`relative w-full h-full flex items-center justify-center overflow-hidden bg-black ring-[1px] ring-white/10 shadow-2xl rounded-lg ${isFixedMode ? 'p-0' : ''}`}
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
                            if (playing && !isTimelineGap) setPlaying(false);
                          }}
                          onDuration={(d: number) => setDuration(d)}
                          onProgress={handleProgress}
                          onError={handlePlayerError}
                          progressInterval={100}
                          style={{
                            objectFit: 'contain',
                            opacity: isTimelineGap ? 0 : 1,
                            filter: previewFilter,
                          }}
                        />
                      </React.Suspense>
                      {previewColorEnabled && (shadowLiftOpacity > 0 || shadowCrushOpacity > 0 || highlightLiftOpacity > 0 || highlightRecoverOpacity > 0 || temperatureOpacity > 0) && (
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
                          {highlightLiftOpacity > 0 && (
                            <div
                              className="absolute inset-0"
                              style={{
                                background: "rgba(255,255,255,1)",
                                mixBlendMode: "soft-light",
                                opacity: highlightLiftOpacity,
                              }}
                            />
                          )}
                          {highlightRecoverOpacity > 0 && (
                            <div
                              className="absolute inset-0"
                              style={{
                                background: "rgba(0,0,0,1)",
                                mixBlendMode: "soft-light",
                                opacity: highlightRecoverOpacity,
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
                  </div>
                </div>

                {/* Right: Visitor Video */}
                <div className="flex-1 w-full h-full flex flex-col items-center justify-center relative min-w-0">
                  <div className="text-xs font-semibold text-white/50 mb-1.5 self-start flex justify-between w-full items-center pr-[140px]">
                    <span>Visitante</span>
                    {compareVideoUrl && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareMuted((prev) => !prev);
                          }}
                          className={`text-[10px] font-medium transition-colors flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer ${
                            compareMuted
                              ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10 border-amber-500/20'
                              : 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                          }`}
                          title={compareMuted ? "Activar audio" : "Silenciar audio"}
                        >
                          {compareMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                          {compareMuted ? "Silenciado" : "Audio activo"}
                        </button>

                        <button
                          onClick={clearCompareVideo}
                          className="text-[10px] text-red-400 hover:text-red-300 font-medium transition-colors flex items-center gap-1 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 cursor-pointer"
                          title="Quitar video"
                        >
                          <Trash2 className="w-3 h-3" />
                          Quitar video
                        </button>
                      </div>
                    )}
                  </div>
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black ring-[1px] ring-white/10 shadow-2xl rounded-lg"
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
                    {compareVideoUrl ? (
                      <video
                        ref={comparePlayerRef}
                        src={compareVideoUrl}
                        className="w-full h-full"
                        muted={compareMuted}
                        style={{
                          objectFit: 'contain',
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-white/10 rounded-lg hover:border-white/20 transition-all bg-white/5">
                        <Upload className="w-8 h-8 text-white/40 mb-3" />
                        <p className="text-sm font-medium text-white/80 mb-1">Cargar video visitante</p>
                        <p className="text-xs text-white/40 max-w-[220px] mb-4">Selecciona un segundo video para comparar en paralelo.</p>
                        <button
                          onClick={handleCompareFileSelectClick}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-md shadow-md transition-colors cursor-pointer"
                        >
                          Seleccionar archivo
                        </button>
                        <input
                          ref={compareFileInputRef}
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={handleCompareFileSelect}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <motion.div 
                data-testid="video-screen"
                onClick={handleScreenClick}
                onDoubleClick={handleScreenDoubleClick}
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
                      onError={handlePlayerError}
                      progressInterval={100}
                      style={{
                        objectFit: isFixedMode ? 'contain' : 'contain',
                        opacity: isTimelineGap ? 0 : 1,
                        filter: previewFilter,
                      }}
                    />
                  </React.Suspense>
                  {previewColorEnabled && (shadowLiftOpacity > 0 || shadowCrushOpacity > 0 || highlightLiftOpacity > 0 || highlightRecoverOpacity > 0 || temperatureOpacity > 0) && (
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
                      {highlightLiftOpacity > 0 && (
                        <div
                          className="absolute inset-0"
                          style={{
                            background: "rgba(255,255,255,1)",
                            mixBlendMode: "soft-light",
                            opacity: highlightLiftOpacity,
                          }}
                        />
                      )}
                      {highlightRecoverOpacity > 0 && (
                        <div
                          className="absolute inset-0"
                          style={{
                            background: "rgba(0,0,0,1)",
                            mixBlendMode: "soft-light",
                            opacity: highlightRecoverOpacity,
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
            )}

            {screenshotModeEnabled && isPlayerSurface && videoUrl && (
              <div
                className="absolute top-4 sm:top-6 left-1/2 -translate-x-1/2 z-[95] flex flex-col items-center gap-1.5 pointer-events-auto"
                onPointerMove={stopScreenshotControlEvent}
                onMouseMove={stopScreenshotControlEvent}
                onPointerDown={stopScreenshotControlEvent}
                onDoubleClick={stopScreenshotControlEvent}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onPointerMove={stopScreenshotControlEvent}
                    onMouseMove={stopScreenshotControlEvent}
                    onPointerDown={stopScreenshotControlEvent}
                    onClick={(event) => {
                      stopScreenshotControlEvent(event);
                      playScreenshotSound();
                      void captureCurrentFrame();
                    }}
                    onDoubleClick={stopScreenshotControlEvent}
                    className="h-10 px-3 rounded-full bg-blue-600/95 hover:bg-blue-500 text-white border border-white/15 shadow-2xl shadow-blue-950/40 backdrop-blur-md flex items-center gap-2 transition-all active:scale-95"
                    title="Capturar pantalla"
                    aria-label="Capturar pantalla"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-xs font-semibold">Captura</span>
                  </button>
                  {screenshotCount > 0 && (
                    <div className="h-7 min-w-7 rounded-full border border-white/10 bg-black/55 px-2.5 text-[11px] font-mono font-semibold text-white/85 shadow-xl backdrop-blur-md flex items-center justify-center">
                      {screenshotCount}
                    </div>
                  )}
                </div>
                {screenshotStatus && (
                  <div
                    className={`w-[108px] rounded-full border px-2 py-1 text-[9px] text-white shadow-xl backdrop-blur-md ${
                      screenshotStatus.type === "success"
                        ? "border-white/10 bg-black/60"
                        : "border-red-300/25 bg-red-950/80"
                    }`}
                    aria-live="polite"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="sr-only">{screenshotStatus.message}</span>
                      <span className="font-mono text-white/75">
                        {screenshotStatus.queued !== undefined && screenshotStatus.queued > 0
                          ? `C${screenshotStatus.queued}`
                          : "OK"}
                      </span>
                      {screenshotStatus.percent !== undefined && (
                        <span className="font-mono text-white/70">
                          {Math.round(screenshotStatus.percent)}%
                        </span>
                      )}
                    </div>
                    {screenshotStatus.percent !== undefined && (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/15">
                        <div
                          className="h-full rounded-full bg-blue-300 transition-[width] duration-200"
                          style={{ width: `${Math.max(0, Math.min(100, screenshotStatus.percent))}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Fullscreen Mode Toggle & Window Controls (top-right) */}
            <AnimatePresence>
              {showControls && (
                <div className="absolute top-4 sm:top-6 right-4 sm:right-6 left-4 sm:left-6 z-[80] flex items-center justify-between pointer-events-none">
                  {/* Left Controls (Player mode only) */}
                  <div className="flex items-center gap-2 pointer-events-auto">
                    {isPlayerSurface && !isCompactWindow && (
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

                  {/* Right Window Controls (Compact, Window Mode, Close) */}
                  {isPlayerSurface && (
                    <motion.div
                      initial={{ opacity: 0, x: 10, y: -10 }}
                      animate={{ opacity: 1, x: 0, y: 0 }}
                      exit={{ opacity: 0, x: 10, y: -10 }}
                      className="flex items-center gap-2 pointer-events-auto bg-black/20 p-1 rounded-full backdrop-blur-sm border border-white/5"
                    >
                      {/* Compact Window Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
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

                      {/* Window Mode Toggle */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          closePlayerMode();
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="p-2 sm:p-2.5 bg-black/40 hover:bg-zinc-700/80 backdrop-blur-md rounded-full text-white/70 hover:text-white transition-all shadow-xl border border-white/10 active:scale-90"
                        title="Ir a edición"
                      >
                        <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>

                      {/* Close Player Button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (hasTauriIpc()) {
                            try {
                              const { appWindow } = await import("@tauri-apps/api/window");
                              await appWindow.close();
                            } catch (err) {
                              console.error("Failed to close window:", err);
                              closePlayerMode();
                            }
                          } else {
                            closePlayerMode();
                          }
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
                    className="mb-1 w-full pointer-events-auto"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div 
                      className="w-full relative cursor-pointer group"
                      style={{ padding: '14px 0' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const bar = e.currentTarget.querySelector('[data-progress-track]') as HTMLElement;
                        if (!bar) return;
                        const updateTime = (clientEx: number) => {
                          const rect = bar.getBoundingClientRect();
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
                        data-progress-track
                        className="w-full h-1.5 bg-white/20 rounded-full relative group-hover:h-2.5 transition-all"
                      >
                        <div
                          className="h-full bg-blue-500 rounded-full relative pointer-events-none shadow-[0_0_18px_rgba(59,130,246,0.55)]"
                          style={{ width: `${playbackDuration > 0 ? (Math.min(currentTime, playbackDuration) / playbackDuration) * 100 : 0}%` }}
                        >
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg shadow-blue-500/40 scale-75 group-hover:scale-100 transition-transform -mr-2 ring-2 ring-blue-500/50" />
                        </div>
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
                        aria-label={playing ? "Pausar" : "Reproducir"}
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

                    {!isCompactWindow && (
                    <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompareMode();
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className={`h-10 px-3 rounded-lg bg-black/65 backdrop-blur-md border flex items-center justify-center transition-all shadow-xl text-white/70 hover:text-white hover:bg-black/85 cursor-pointer ${
                        compareMode ? 'border-blue-400/60 text-blue-200 shadow-blue-500/20' : 'border-white/10'
                      }`}
                      title="Comparar videos"
                    >
                      <Columns2 className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline text-xs font-medium">Comparar</span>
                    </button>

                    <div
                      ref={imageControlsRef}
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
                          <div className="mb-3">
                            <div>
                              <div className="text-sm font-semibold">Mejorar imagen</div>
                              <div className="text-[11px] text-white/50">Los ajustes se exportan con el video</div>
                            </div>
                          </div>

                          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-300/20 bg-blue-300/10 px-3 py-2.5">
                            <div>
                              <div className="text-xs font-semibold text-blue-100">Modo capturas</div>
                              <div className="text-[10px] text-blue-100/55">Deja fija la camara arriba del reproductor.</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={screenshotModeEnabled}
                              onClick={() => setScreenshotModeEnabled((enabled) => !enabled)}
                              className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                                screenshotModeEnabled
                                  ? "border-blue-300/50 bg-blue-500"
                                  : "border-white/15 bg-white/10"
                              }`}
                            >
                              <span
                                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                  screenshotModeEnabled ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          <div className="grid grid-cols-4 gap-1.5 mb-4">
                            {colorPresets.map((preset) => (
                              <button
                                key={preset.label}
                                onClick={() => applyColorPreset(preset.values)}
                                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>

                          <div className="mb-4 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={scanVideoImage}
                              disabled={!videoUrl || !!imageScanProgress}
                              className="flex items-center justify-center rounded-md border border-blue-300/25 bg-blue-300/10 px-2 py-2 text-[11px] font-semibold text-blue-200 transition-colors hover:bg-blue-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {imageScanProgress
                                ? imageScanProgress.phase === "computing"
                                  ? "Finalizando"
                                  : `Escaneando ${imageScanPercent}%`
                                : "Escanear video"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowOriginalPreview(!showOriginalPreview)}
                              disabled={!colorCorrection.enabled}
                              className={`flex items-center justify-center rounded-md border px-2 py-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                showOriginalPreview
                                  ? "border-amber-300/35 bg-amber-300/15 text-amber-100 hover:bg-amber-300/20"
                                  : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white"
                              }`}
                            >
                              {showOriginalPreview ? "Ver con efecto" : "Ver original"}
                            </button>
                          </div>
                          {imageScanProgress && (
                            <div className="mb-4 space-y-1.5 rounded-md border border-blue-300/15 bg-blue-300/5 p-2.5">
                              <div className="h-2 overflow-hidden rounded-full bg-blue-950/70">
                                <div
                                  className="h-full rounded-full bg-blue-400 transition-[width] duration-150"
                                  style={{ width: `${imageScanPercent}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-blue-100/70">
                                <span>{imageScanProgress.message}</span>
                                <span className="font-mono">{imageScanProgress.current}/{imageScanProgress.total}</span>
                              </div>
                            </div>
                          )}
                          {imageAnalysis && !imageScanProgress && (
                            <div className="mb-4 space-y-2 rounded-md border border-emerald-300/20 bg-emerald-300/5 p-2.5">
                              <div className="text-[11px] font-semibold text-emerald-200">Analisis listo - video sin modificar</div>
                              <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-white/55">
                                <div><div className="font-mono text-white/85">{imageAnalysis.shadowsPercent}%</div>Negros</div>
                                <div><div className="font-mono text-white/85">{imageAnalysis.highlightsPercent}%</div>Luces</div>
                                <div><div className="font-mono text-white/85">{imageAnalysis.averageLight}%</div>Media</div>
                              </div>
                              <div className="text-[10px] text-white/45">{imageAnalysis.sampledFrames} escenas revisadas para ajustes manuales.</div>
                            </div>
                          )}

                          {[
                            ["Brillo", "brightness", -50, 50],
                            ["Luces", "highlights", -50, 50],
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
                          if (isCompactWindow || compactWindowSnapshotRef.current) {
                            closeCompactWindowToEditor().catch(() => {});
                          } else {
                            setAppMode("editor");
                            if (isFullscreen) {
                              exitFullscreenNative().catch(() => {});
                            }
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
                    </>
                    )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {(playerError || fullscreenError) && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] text-white text-xs px-3 py-2 rounded-md shadow-lg bg-red-500/90">
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
