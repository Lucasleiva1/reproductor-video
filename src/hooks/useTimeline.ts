import { create } from "zustand";

interface TimelineState {
  videoFile: File | null;
  videoUrl: string | null;
  duration: number;
  currentTime: number;
  startTime: number;
  endTime: number;
  zoom: number; // 10 to 500, default 100 representing 1x
  posX: number; // 0 to 100 normalized, 50 is center
  posY: number; // 0 to 100 normalized, 50 is center
  playing: boolean;
  setVideoFile: (file: File | null, url: string | null) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setStartTime: (time: number) => void;
  setEndTime: (time: number) => void;
  setZoom: (zoom: number) => void;
  setPosX: (x: number) => void;
  setPosY: (y: number) => void;
  setPlaying: (playing: boolean) => void;
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
  posX: 50, // 50 = center
  posY: 50, // 50 = center
  playing: false,

  setVideoFile: (file, url) => set({ videoFile: file, videoUrl: url, playing: false }),
  setDuration: (duration) => set({ duration, endTime: duration }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setStartTime: (time) => set({ startTime: time }),
  setEndTime: (time) => set({ endTime: time }),
  setZoom: (zoom) => set({ zoom }),
  setPosX: (posX) => set({ posX }),
  setPosY: (posY) => set({ posY }),
  setPlaying: (playing) => set({ playing }),
  resetTransform: () => set({ zoom: 100, posX: 50, posY: 50 }),
}));
