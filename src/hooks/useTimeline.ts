import { create } from "zustand";

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

interface TimelineState {
  videoFile: File | null;
  videoUrl: string | null;
  duration: number; // Total timeline duration (max startAt + trimEnd - trimStart)
  currentTime: number;
  clips: Clip[];
  zoom: number; // 10 to 500, default 100 representing 1x (Video zoom inside the canvas)
  canvasScale: number; // 0.1 to 3.0 (Whole canvas size zoom)
  posX: number; // 0 to 100 normalized, 50 is center
  posY: number; // 0 to 100 normalized, 50 is center
  playing: boolean;
  resolution: Resolution;
  setVideoFile: (file: File | null, url: string | null) => void;
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
  setPlaying: (playing: boolean) => void;
  setResolution: (res: Resolution) => void;
  resetTransform: () => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

export const useTimeline = create<TimelineState>((set, get) => ({
  videoFile: null,
  videoUrl: null,
  duration: 0,
  currentTime: 0,
  clips: [],
  zoom: 100, // 100 = 1x
  canvasScale: 1, // 1 = 100% of the available area
  posX: 50, // 50 = center
  posY: 50, // 50 = center
  playing: false,
  resolution: RESOLUTIONS[2],

  setVideoFile: (file, url) => {
    // When a new file is loaded, create an initial clip right at 0s.
    // We don't know the exact duration yet, wait for setDuration to update it.
    set({ 
      videoFile: file, 
      videoUrl: url, 
      playing: false,
      currentTime: 0,
      clips: [] // reset clips until we know the duration
    });
  },
  
  setDuration: (duration) => {
    const { videoUrl, clips } = get();
    // If we just loaded a video and don't have clips, create the first main clip spanning the whole video.
    if (clips.length === 0 && videoUrl) {
      set({
        duration,
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
      const maxEnd = newClips.reduce((max, clip) => Math.max(max, clip.startAt + (clip.trimEnd - clip.trimStart)), 0);
      // Give a tiny buffer at the end of the timeline
      return { clips: newClips, duration: maxEnd > 0 ? maxEnd : state.duration };
    });
  },

  updateClip: (id, updates) => {
    const { clips, setClips } = get();
    setClips(clips.map(c => c.id === id ? { ...c, ...updates } : c));
  },

  splitClip: (id, splitTimeGlobal) => {
    const { clips, setClips } = get();
    const clipIndex = clips.findIndex(c => c.id === id);
    if (clipIndex === -1) return;

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
    const { clips, setClips } = get();
    setClips(clips.filter(c => c.id !== id));
  },

  setZoom: (zoom) => set({ zoom }),
  setCanvasScale: (canvasScale) => set({ canvasScale }),
  setPosX: (posX) => set({ posX }),
  setPosY: (posY) => set({ posY }),
  setPlaying: (playing) => set({ playing }),
  setResolution: (res) => set({ resolution: res }),
  resetTransform: () => set({ zoom: 100, posX: 50, posY: 50 }),
}));
