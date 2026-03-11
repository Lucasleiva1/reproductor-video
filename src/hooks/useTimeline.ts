import { create } from "zustand";

export type Resolution = { w: number; h: number; name: string };
export const RESOLUTIONS: Resolution[] = [
  { w: 1920, h: 1080, name: "HD (1920x1080)" },
  { w: 1280, h: 720, name: "720p (1280x720)" },
  { w: 1080, h: 1920, name: "Vertical (1080x1920)" },
  { w: 1080, h: 1080, name: "Square (1080x1080)" }
];

interface TimelineState {
  videoFile: File | null;
  videoUrl: string | null;
  duration: number;
  currentTime: number;
  startTime: number;
  endTime: number;
  zoom: number; // 10 to 500, default 100 representing 1x (Video zoom inside the canvas)
  canvasScale: number; // 0.1 to 3.0 (Whole canvas size zoom, what the user asked for)
  posX: number; // 0 to 100 normalized, 50 is center
  posY: number; // 0 to 100 normalized, 50 is center
  playing: boolean;
  resolution: Resolution;
  setVideoFile: (file: File | null, url: string | null) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setStartTime: (time: number) => void;
  setEndTime: (time: number) => void;
  setZoom: (zoom: number) => void;
  setCanvasScale: (scale: number) => void;
  setPosX: (x: number) => void;
  setPosY: (y: number) => void;
  setPlaying: (playing: boolean) => void;
  setResolution: (res: Resolution) => void;
  resetTransform: () => void;
}

export const useTimeline = create<TimelineState>((set) => ({
  videoFile: null,
  videoUrl: null,
  duration: 0,
  currentTime: 0,
  startTime: 0,
  endTime: 0,
  zoom: 100, // 100 = 1x
  canvasScale: 1, // 1 = 100% of the available area
  posX: 50, // 50 = center
  posY: 50, // 50 = center
  playing: false,
  resolution: RESOLUTIONS[0],

  setVideoFile: (file, url) => set({ videoFile: file, videoUrl: url, playing: false }),
  setDuration: (duration) => set({ duration, endTime: duration }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setStartTime: (time) => set({ startTime: time }),
  setEndTime: (time) => set({ endTime: time }),
  setZoom: (zoom) => set({ zoom }),
  setCanvasScale: (canvasScale) => set({ canvasScale }),
  setPosX: (posX) => set({ posX }),
  setPosY: (posY) => set({ posY }),
  setPlaying: (playing) => set({ playing }),
  setResolution: (res) => set({ resolution: res }),
  resetTransform: () => set({ zoom: 100, posX: 50, posY: 50 }),
}));
