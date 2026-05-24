import { create } from "zustand";
import { generateThumbnails } from "@/utils/thumbnailGenerator";
import { getContentDuration, rippleDeleteClip } from "@/utils/timeline";
import type { VideoImageAnalysis } from "@/utils/videoAnalyzer";

export type Resolution = { w: number; h: number; name: string };
export const RESOLUTIONS: Resolution[] = [
  { w: 3840, h: 2160, name: "4K (3840×2160)" },
  { w: 2560, h: 1440, name: "2K (2560×1440)" },
  { w: 1920, h: 1080, name: "HD (1920×1080)" },
  { w: 1280, h: 720, name: "720p (1280×720)" },
  { w: 1080, h: 1920, name: "Vertical (1080×1920)" },
  { w: 1080, h: 1080, name: "Square (1080×1080)" }
];

export interface Clip {
  id: string;
  videoUrl: string;
  sourceDuration: number; // Original total duration of the source video
  startAt: number;        // The time on the global timeline where this clip starts playing
  trimStart: number;      // The start time relative to the original source video
  trimEnd: number;        // The end time relative to the original source video
}

export type AppMode = "editor" | "player";

export interface ColorCorrection {
  enabled: boolean;
  brightness: number;
  highlights: number;
  contrast: number;
  saturation: number;
  shadows: number;
  temperature: number;
}

export const DEFAULT_COLOR_CORRECTION: ColorCorrection = {
  enabled: false,
  brightness: 0,
  highlights: 0,
  contrast: 0,
  saturation: 0,
  shadows: 0,
  temperature: 0,
};

interface TimelineState {
  appMode: AppMode;
  videoFile: File | null;
  videoUrl: string | null;
  videoPath: string | null;
  duration: number; // Total timeline duration (max startAt + trimEnd - trimStart)
  currentTime: number;
  clips: Clip[];
  zoom: number; // 10 to 500, default 100 representing 1x (Video zoom inside the canvas)
  canvasScale: number; // 0.1 to 3.0 (Whole canvas size zoom)
  posX: number; // 0 to 100 normalized, 50 is center
  posY: number; // 0 to 100 normalized, 50 is center
  colorCorrection: ColorCorrection;
  imageAnalysis: VideoImageAnalysis | null;
  showOriginalPreview: boolean;
  playing: boolean;
  resolution: Resolution;

  // History state
  past: { clips: Clip[], duration: number }[];
  future: { clips: Clip[], duration: number }[];
  saveHistory: () => void;
  undo: () => void;
  redo: () => void;

  setVideoFile: (file: File | null, url: string | null) => void;
  loadVideoByPath: (path: string, autoplay?: boolean) => Promise<void>;
  setAppMode: (mode: AppMode) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setClips: (clips: Clip[] | ((prev: Clip[]) => Clip[])) => void;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  splitClip: (id: string, splitTimeGlobal: number) => void;
  removeClip: (id: string) => void;
  setZoom: (zoom: number) => void;
  setCanvasScale: (scale: number) => void;
  setPosX: (x: number) => void;
  setPosY: (y: number) => void;
  setColorCorrection: (updates: Partial<ColorCorrection>) => void;
  setImageAnalysis: (analysis: VideoImageAnalysis | null) => void;
  setShowOriginalPreview: (showOriginal: boolean) => void;
  resetColorCorrection: () => void;
  setPlaying: (playing: boolean) => void;
  setResolution: (res: Resolution) => void;
  resetTransform: () => void;

  // Header visibility toggles
  headerShowLang: boolean;
  headerShowRes: boolean;
  headerShowShortcuts: boolean;
  headerShowTheme: boolean;
  headerShowTutorial: boolean;
  setHeaderShowLang: (v: boolean) => void;
  setHeaderShowRes: (v: boolean) => void;
  setHeaderShowShortcuts: (v: boolean) => void;
  setHeaderShowTheme: (v: boolean) => void;
  setHeaderShowTutorial: (v: boolean) => void;

  // Blade mode limit: 0 = unlimited, 1 = one cut, 2 = two cuts
  bladeModeLimit: number;
  setBladeModeLimit: (v: number) => void;


  // Timeline time display mode: 'seconds', 'minutes', 'hidden'
  timelineTimeMode: 'seconds' | 'minutes' | 'hidden';
  setTimelineTimeMode: (v: 'seconds' | 'minutes' | 'hidden') => void;
  showTips: boolean;
  setShowTips: (v: boolean) => void;
  isFullscreen: boolean;
  setIsFullscreen: (v: boolean) => void;
  fsTransitioning: boolean;
  setFsTransitioning: (v: boolean) => void;

  thumbnails: string[];
  isGeneratingThumbnails: boolean;
  ensureThumbnails: () => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);
let thumbnailGenerationToken = 0;

export const useTimeline = create<TimelineState>((set, get) => ({
  // Header visibility (default all true)
  headerShowLang: typeof window !== 'undefined' ? localStorage.getItem('headerShowLang') !== 'false' : true,
  headerShowRes: typeof window !== 'undefined' ? localStorage.getItem('headerShowRes') !== 'false' : true,
  headerShowShortcuts: typeof window !== 'undefined' ? localStorage.getItem('headerShowShortcuts') !== 'false' : true,
  headerShowTheme: typeof window !== 'undefined' ? localStorage.getItem('headerShowTheme') !== 'false' : true,
  headerShowTutorial: typeof window !== 'undefined' ? localStorage.getItem('headerShowTutorial') !== 'false' : true,
  setHeaderShowLang: (v) => { if (typeof window !== 'undefined') localStorage.setItem('headerShowLang', String(v)); set({ headerShowLang: v }); },
  setHeaderShowRes: (v) => { if (typeof window !== 'undefined') localStorage.setItem('headerShowRes', String(v)); set({ headerShowRes: v }); },
  setHeaderShowShortcuts: (v) => { if (typeof window !== 'undefined') localStorage.setItem('headerShowShortcuts', String(v)); set({ headerShowShortcuts: v }); },
  setHeaderShowTheme: (v) => { if (typeof window !== 'undefined') localStorage.setItem('headerShowTheme', String(v)); set({ headerShowTheme: v }); },
  setHeaderShowTutorial: (v) => { if (typeof window !== 'undefined') localStorage.setItem('headerShowTutorial', String(v)); set({ headerShowTutorial: v }); },

  // Blade mode limit (default 2)
  bladeModeLimit: typeof window !== 'undefined' ? parseInt(localStorage.getItem('bladeModeLimit') || '2', 10) : 2,
  setBladeModeLimit: (v) => { if (typeof window !== 'undefined') localStorage.setItem('bladeModeLimit', String(v)); set({ bladeModeLimit: v }); },

  videoFile: null,
  appMode: "editor",
  videoUrl: null,
  videoPath: null,
  duration: 0,
  currentTime: 0,
  clips: [],
  zoom: 100, // 100 = 1x
  canvasScale: 1, // 1 = 100% of the available area
  posX: 50, // 50 = center
  posY: 50, // 50 = center
  colorCorrection: DEFAULT_COLOR_CORRECTION,
  imageAnalysis: null,
  showOriginalPreview: false,
  playing: false,
  resolution: RESOLUTIONS[2],

  timelineTimeMode: typeof window !== 'undefined' ? (localStorage.getItem('timelineTimeMode') as any || 'seconds') : 'seconds',
  setTimelineTimeMode: (v) => { 
    if (typeof window !== 'undefined') localStorage.setItem('timelineTimeMode', v); 
    set({ timelineTimeMode: v }); 
  },
  showTips: typeof window !== 'undefined' ? localStorage.getItem('showTips') !== 'false' : true,
  setShowTips: (v) => {
    if (typeof window !== 'undefined') localStorage.setItem('showTips', String(v));
    set({ showTips: v });
  },
  isFullscreen: false,
  setIsFullscreen: (v) => set({ isFullscreen: v }),
  fsTransitioning: false,
  setFsTransitioning: (v) => set({ fsTransitioning: v }),

  thumbnails: [],
  isGeneratingThumbnails: false,
  ensureThumbnails: () => {
    const { videoUrl, clips, thumbnails, isGeneratingThumbnails, appMode } = get();
    const sourceDuration = clips[0]?.sourceDuration ?? 0;
    if (!videoUrl || sourceDuration <= 0 || appMode !== "editor" || isGeneratingThumbnails) return;

    const targetCount = Math.min(96, Math.max(24, Math.ceil(sourceDuration / 1.5)));
    const readyCount = thumbnails.filter(Boolean).length;
    if (readyCount >= Math.ceil(targetCount * 0.85)) return;

    const tokenAtStart = thumbnailGenerationToken;
    const sourceVideoUrl = videoUrl;
    set({ isGeneratingThumbnails: true, thumbnails: readyCount > 0 ? thumbnails : [] });

    generateThumbnails({
      videoUrl,
      duration: sourceDuration,
      maxThumbnails: targetCount,
      thumbnailWidth: 192,
      thumbnailQuality: 0.78,
      shouldAbort: () => {
        const state = get();
        return (
          tokenAtStart !== thumbnailGenerationToken ||
          state.videoUrl !== sourceVideoUrl ||
          state.appMode !== "editor"
        );
      },
      onThumbnail: (index, _total, dataUrl) => {
        set((state) => {
          if (
            tokenAtStart !== thumbnailGenerationToken ||
            state.videoUrl !== sourceVideoUrl
          ) {
            return state;
          }
          const nextThumbnails = [...state.thumbnails];
          nextThumbnails[index] = dataUrl;
          return { thumbnails: nextThumbnails };
        });
      }
    }).finally(() => {
      if (tokenAtStart !== thumbnailGenerationToken) return;
      set({ isGeneratingThumbnails: false });
    });
  },

  past: [],
  future: [],

  saveHistory: () => {
    set((state) => {
      const newPast = [...state.past, { clips: state.clips, duration: state.duration }];
      if (newPast.length > 50) newPast.shift(); // Keep max 50 steps
      return { past: newPast, future: [] };
    });
  },

  undo: () => {
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      const newFuture = [{ clips: state.clips, duration: state.duration }, ...state.future];
      return { 
        past: newPast, 
        future: newFuture, 
        clips: previous.clips, 
        duration: previous.duration 
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      const newPast = [...state.past, { clips: state.clips, duration: state.duration }];
      return { 
        past: newPast, 
        future: newFuture, 
        clips: next.clips, 
        duration: next.duration 
      };
    });
  },

  setVideoFile: (file, url) => {
    // When a new file is loaded, create an initial clip right at 0s.
    // We don't know the exact duration yet, wait for setDuration to update it.
    thumbnailGenerationToken += 1;
    set(() => ({ 
      videoFile: file, 
      appMode: "editor",
      videoUrl: url, 
      videoPath: null, // Clear path if we have a File object
      currentTime: 0,
      clips: [], // reset clips until we know the duration
      playing: false,
      imageAnalysis: null,
      showOriginalPreview: false,
      thumbnails: [],
      isGeneratingThumbnails: false,
    }));
  },
  
  loadVideoByPath: async (path, autoplay = false) => {
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/tauri');
      const { invoke } = await import('@tauri-apps/api/tauri');
      // Ensure Tauri allows access to this file path
      try { await invoke('allow_file_access', { path }); } catch(_) {}
      const url = convertFileSrc(path);
      thumbnailGenerationToken += 1;
      set(() => ({
        videoFile: null,
        appMode: autoplay ? "player" : "editor",
        videoUrl: url,
        videoPath: path,
        currentTime: 0,
        clips: [],
        playing: autoplay,
        imageAnalysis: null,
        showOriginalPreview: false,
        thumbnails: [],
        isGeneratingThumbnails: false
      }));
    } catch (err) {
      console.error("Failed to load video by path:", err);
    }
  },

  setAppMode: (appMode) => set({ appMode }),
  
  setDuration: (duration) => {
    const { videoUrl, clips } = get();
    // If we just loaded a video and don't have clips, create the first main clip spanning the whole video.
    if (clips.length === 0 && videoUrl) {
      set({
        // Add a 10s initial visual buffer so the clip doesn't occupy 100% of the screen width visually
        duration: duration > 0 ? duration + 10 : 30,
        clips: [{
          id: generateId(),
          videoUrl,
          sourceDuration: duration,
          startAt: 0,
          trimStart: 0,
          trimEnd: duration
        }]
      });

    } else {
      // If we are dynamically computing timeline duration based on clips
      set({ duration });
    }
  },
  
  setCurrentTime: (time) => set({ currentTime: time }),
  
  setClips: (updater) => {
    set((state) => {
      const newClips = typeof updater === 'function' ? updater(state.clips) : updater;
      // Re-calculate total duration based on the furthest ending clip
      const maxEnd = getContentDuration(newClips);
      
      // Prevent the timeline from shrinking dynamically during edits. 
      // Only grow it, adding a nice 10s visual buffer at the end.
      const neededDuration = maxEnd + 10;
      const newDuration = Math.max(state.duration, neededDuration);
      
      return { clips: newClips, duration: newDuration };
    });
  },

  updateClip: (id, updates) => {
    const { clips, setClips } = get();
    setClips(clips.map(c => c.id === id ? { ...c, ...updates } : c));
  },

  splitClip: (id, splitTimeGlobal) => {
    const { clips, setClips, saveHistory } = get();
    const clipIndex = clips.findIndex(c => c.id === id);
    if (clipIndex === -1) return;

    saveHistory();

    const clip = clips[clipIndex];
    // Global split time relative to the clip's local start Time
    const localSplitTime = (splitTimeGlobal - clip.startAt) + clip.trimStart;

    // Reject if trying to split outside the clip bounds
    if (splitTimeGlobal <= clip.startAt || splitTimeGlobal >= clip.startAt + (clip.trimEnd - clip.trimStart)) return;

    const leftClip: Clip = {
      ...clip,
      trimEnd: localSplitTime
    };

    const rightClip: Clip = {
      ...clip,
      id: generateId(),
      startAt: splitTimeGlobal,
      trimStart: localSplitTime
    };

    const newClips = [...clips];
    newClips.splice(clipIndex, 1, leftClip, rightClip);
    setClips(newClips);
  },

  removeClip: (id) => {
    const { clips, setClips, saveHistory } = get();
    saveHistory();
    setClips(rippleDeleteClip(clips, id));
  },

  setZoom: (zoom) => set({ zoom }),
  setCanvasScale: (canvasScale) => set({ canvasScale }),
  setPosX: (posX) => set({ posX }),
  setPosY: (posY) => set({ posY }),
  setColorCorrection: (updates) => {
    set((state) => ({
      colorCorrection: {
        ...state.colorCorrection,
        ...updates,
      },
      showOriginalPreview: updates.enabled === false ? false : state.showOriginalPreview,
    }));
  },
  setImageAnalysis: (imageAnalysis) => set({ imageAnalysis }),
  setShowOriginalPreview: (showOriginalPreview) => set({ showOriginalPreview }),
  resetColorCorrection: () => set({ colorCorrection: DEFAULT_COLOR_CORRECTION, showOriginalPreview: false }),
  setPlaying: (playing) => {
    const current = get().playing;
    if (current !== playing) set({ playing });
  },
  setResolution: (res) => set({ resolution: res }),
  resetTransform: () => set({ zoom: 100, posX: 50, posY: 50 }),
}));
