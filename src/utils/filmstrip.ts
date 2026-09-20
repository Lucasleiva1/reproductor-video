// Timeline filmstrip frame cache.
//
// Frames are extracted on demand (visible tiles first) from a hidden <video>, kept as small JPEG
// blobs in memory and persisted in IndexedDB keyed by video identity + time, so each frame is
// decoded only once and reopening the same video shows the strip immediately.
//
// Frame times live on a power-of-two grid (…, 0.25s, 0.5s, 1s, 2s, …). A frame taken for a coarse
// zoom level is exactly reusable at every finer level, so zooming in only adds the missing frames.

const DB_NAME = "flowuana-filmstrip";
const DB_VERSION = 1;
const FRAMES_STORE = "frames";
const VIDEOS_STORE = "videos";
const MAX_CACHE_BYTES = 500 * 1024 * 1024;
const FRAME_HEIGHT = 92; // 2x the 46px strip so tiles stay sharp on HiDPI screens
const MIN_GRID_SECONDS = 0.125;
const BASE_FRAME_COUNT = 120;
const MEMORY_URL_LIMIT = 600;
const PLAYING_THROTTLE_MS = 400;
const SEEK_TIMEOUT_MS = 5000;
const NOTIFY_DELAY_MS = 100;

export const DEFAULT_ASPECT = 16 / 9;

/** Largest power-of-two step (in seconds) that fits inside one tile. */
export const gridStepFor = (secondsPerTile: number) => {
  const step = Math.pow(2, Math.floor(Math.log2(Math.max(MIN_GRID_SECONDS, secondsPerTile))));
  return Math.max(MIN_GRID_SECONDS, step);
};

/** Frame key (ms) that represents a tile centered at `centerSeconds`. */
export const frameKeyFor = (centerSeconds: number, secondsPerTile: number, sourceDuration: number) => {
  const step = gridStepFor(secondsPerTile);
  const snapped = Math.min(Math.max(0, Math.round(centerSeconds / step) * step), Math.max(0, sourceDuration));
  return Math.round(snapped * 1000);
};

// ---------- IndexedDB ----------

interface VideoRecord {
  videoKey: string;
  lastUsed: number;
  bytes: number;
  aspect: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FRAMES_STORE)) db.createObjectStore(FRAMES_STORE);
        if (!db.objectStoreNames.contains(VIDEOS_STORE)) db.createObjectStore(VIDEOS_STORE, { keyPath: "videoKey" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const idbRequest = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const frameRange = (videoKey: string) => IDBKeyRange.bound([videoKey, -Infinity], [videoKey, Infinity]);

const listStoredTimes = async (videoKey: string): Promise<number[]> => {
  const db = await openDb();
  if (!db) return [];
  try {
    const keys = await idbRequest(db.transaction(FRAMES_STORE).objectStore(FRAMES_STORE).getAllKeys(frameRange(videoKey)));
    return (keys as [string, number][]).map((key) => key[1]);
  } catch {
    return [];
  }
};

const readStoredFrame = async (videoKey: string, t: number): Promise<Blob | null> => {
  const db = await openDb();
  if (!db) return null;
  try {
    const blob = await idbRequest(db.transaction(FRAMES_STORE).objectStore(FRAMES_STORE).get([videoKey, t]));
    return blob instanceof Blob ? blob : null;
  } catch {
    return null;
  }
};

const writeStoredFrame = async (videoKey: string, t: number, blob: Blob) => {
  const db = await openDb();
  if (!db) return;
  try {
    await idbRequest(db.transaction(FRAMES_STORE, "readwrite").objectStore(FRAMES_STORE).put(blob, [videoKey, t]));
  } catch {
    // Quota or private mode: the strip still works from memory.
  }
};

const readVideoRecord = async (videoKey: string): Promise<VideoRecord | null> => {
  const db = await openDb();
  if (!db) return null;
  try {
    return ((await idbRequest(db.transaction(VIDEOS_STORE).objectStore(VIDEOS_STORE).get(videoKey))) as VideoRecord) ?? null;
  } catch {
    return null;
  }
};

const writeVideoRecord = async (record: VideoRecord) => {
  const db = await openDb();
  if (!db) return;
  try {
    await idbRequest(db.transaction(VIDEOS_STORE, "readwrite").objectStore(VIDEOS_STORE).put(record));
  } catch {
    // ignore
  }
};

/** Drops the least recently used videos until the whole cache fits in MAX_CACHE_BYTES. */
const evictOldVideos = async (keepKey: string) => {
  const db = await openDb();
  if (!db) return;
  try {
    const records = ((await idbRequest(db.transaction(VIDEOS_STORE).objectStore(VIDEOS_STORE).getAll())) as VideoRecord[])
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let total = records.reduce((sum, r) => sum + (r.bytes || 0), 0);
    for (const record of records) {
      if (total <= MAX_CACHE_BYTES) break;
      if (record.videoKey === keepKey) continue;
      const tx = db.transaction([FRAMES_STORE, VIDEOS_STORE], "readwrite");
      tx.objectStore(FRAMES_STORE).delete(frameRange(record.videoKey));
      tx.objectStore(VIDEOS_STORE).delete(record.videoKey);
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
      total -= record.bytes || 0;
    }
  } catch {
    // ignore
  }
};

// ---------- Frame source ----------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const insertSorted = (list: number[], value: number) => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] !== value) list.splice(lo, 0, value);
};

const nearestIn = (list: number[], value: number) => {
  if (list.length === 0) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  const after = list[lo];
  const before = lo > 0 ? list[lo - 1] : after;
  return Math.abs(before - value) <= Math.abs(after - value) ? before : after;
};

export class FilmstripSource {
  readonly videoKey: string;
  readonly url: string;
  aspect = DEFAULT_ASPECT;
  version = 0;

  private duration: number;
  private isPlaying: () => boolean;
  private stored = new Set<number>(); // frames present in IndexedDB
  private urls = new Map<number, string>(); // frames loaded in memory (insertion order = LRU)
  private loadedTimes: number[] = []; // sorted keys of `urls`, for nearest-frame fallback
  private loading = new Set<number>();
  private wanted: number[] = [];
  private wantedBy = new Map<string, number[]>();
  private background: number[] = [];
  private active = true;
  private disposed = false;
  private running = false;
  private video: HTMLVideoElement | null = null;
  private videoReady: Promise<boolean> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private bytes = 0;
  private framesSinceRecord = 0;
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(videoKey: string, url: string, duration: number, isPlaying: () => boolean) {
    this.videoKey = videoKey;
    this.url = url;
    this.duration = duration;
    this.isPlaying = isPlaying;
    void this.init();
  }

  private async init() {
    const [times, record] = await Promise.all([listStoredTimes(this.videoKey), readVideoRecord(this.videoKey)]);
    if (this.disposed) return;
    times.forEach((t) => this.stored.add(t));
    if (record) {
      this.aspect = record.aspect || DEFAULT_ASPECT;
      this.bytes = record.bytes || 0;
    }
    void writeVideoRecord({ videoKey: this.videoKey, lastUsed: Date.now(), bytes: this.bytes, aspect: this.aspect });
    void evictOldVideos(this.videoKey);
    this.scheduleBaseFrames();
    this.notify(true);
    this.pump();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getVersion = () => this.version;

  setDuration(duration: number) {
    if (duration > 0 && Math.abs(duration - this.duration) > 0.01) {
      this.duration = duration;
      this.scheduleBaseFrames();
      this.pump();
    }
  }

  /** Pause all work (e.g. the timeline is hidden in player mode). */
  setActive(active: boolean) {
    this.active = active;
    if (active) this.pump();
  }

  /**
   * Best frame to show for `key`: the exact one when ready, otherwise the closest frame already in
   * memory so tiles never flash empty while zooming.
   */
  frameUrl(key: number): string | null {
    const exact = this.urls.get(key);
    if (exact) return exact;
    const nearest = nearestIn(this.loadedTimes, key);
    return nearest === null ? null : this.urls.get(nearest) ?? null;
  }

  /**
   * Frames needed by one clip's visible tiles, most important first. Each clip replaces only its
   * own previous request; requests from all clips are interleaved so none of them starves.
   */
  setWanted(owner: string, keys: number[]) {
    if (keys.length) this.wantedBy.set(owner, keys);
    else this.wantedBy.delete(owner);
    const lists = [...this.wantedBy.values()];
    const merged: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; lists.some((list) => i < list.length); i++) {
      for (const list of lists) {
        const key = list[i];
        if (key === undefined || seen.has(key) || this.urls.has(key)) continue;
        seen.add(key);
        merged.push(key);
      }
    }
    this.wanted = merged;
    this.pump();
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
    this.loadedTimes = [];
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
  }

  private scheduleBaseFrames() {
    if (this.duration <= 0) return;
    const step = gridStepFor(this.duration / BASE_FRAME_COUNT);
    const keys: number[] = [];
    for (let t = 0; t <= this.duration; t += step) keys.push(Math.round(t * 1000));
    this.background = keys.filter((key) => !this.urls.has(key));
  }

  private notify(immediate = false) {
    if (this.disposed) return;
    if (this.notifyTimer) {
      if (!immediate) return;
      clearTimeout(this.notifyTimer);
    }
    const fire = () => {
      this.notifyTimer = null;
      this.version += 1;
      this.listeners.forEach((listener) => listener());
    };
    if (immediate) fire();
    else this.notifyTimer = setTimeout(fire, NOTIFY_DELAY_MS);
  }

  private remember(key: number, blob: Blob) {
    if (this.urls.has(key)) return;
    this.urls.set(key, URL.createObjectURL(blob));
    insertSorted(this.loadedTimes, key);
    // Keep memory bounded: forget the oldest loaded frames (they stay on disk).
    while (this.urls.size > MEMORY_URL_LIMIT) {
      const [oldKey, oldUrl] = this.urls.entries().next().value as [number, string];
      if (this.wanted.includes(oldKey)) break;
      this.urls.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
      const index = this.loadedTimes.indexOf(oldKey);
      if (index >= 0) this.loadedTimes.splice(index, 1);
    }
    this.notify();
  }

  private nextKey(): number | null {
    while (this.wanted.length) {
      const key = this.wanted.shift()!;
      if (!this.urls.has(key)) return key;
    }
    while (this.background.length) {
      const key = this.background.shift()!;
      if (!this.urls.has(key)) return key;
    }
    return null;
  }

  private pump() {
    if (this.running || this.disposed || !this.active) return;
    this.running = true;
    void this.run().finally(() => { this.running = false; });
  }

  private async run() {
    while (!this.disposed && this.active) {
      const key = this.nextKey();
      if (key === null) return;
      if (this.loading.has(key)) continue;
      this.loading.add(key);
      try {
        if (this.stored.has(key)) {
          // Already decoded in a previous session: just read it back.
          const blob = await readStoredFrame(this.videoKey, key);
          if (blob) {
            this.remember(key, blob);
            continue;
          }
          this.stored.delete(key);
        }
        // Background frames give way to playback; visible frames are still fetched, just slower.
        if (this.isPlaying()) await sleep(PLAYING_THROTTLE_MS);
        if (this.disposed) return;
        const blob = await this.extract(key / 1000);
        if (!blob) continue;
        this.remember(key, blob);
        this.stored.add(key);
        this.bytes += blob.size;
        void writeStoredFrame(this.videoKey, key, blob);
        if (++this.framesSinceRecord >= 40) {
          this.framesSinceRecord = 0;
          void writeVideoRecord({ videoKey: this.videoKey, lastUsed: Date.now(), bytes: this.bytes, aspect: this.aspect });
        }
      } finally {
        this.loading.delete(key);
      }
    }
  }

  private ensureVideo() {
    if (this.videoReady) return this.videoReady;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    this.video = video;
    this.videoReady = new Promise<boolean>((resolve) => {
      video.onloadedmetadata = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const aspect = video.videoWidth / video.videoHeight;
          if (Math.abs(aspect - this.aspect) > 0.001) {
            this.aspect = aspect;
            void writeVideoRecord({ videoKey: this.videoKey, lastUsed: Date.now(), bytes: this.bytes, aspect });
            this.notify(true);
          }
        }
        if (video.duration > 0 && Number.isFinite(video.duration)) this.setDuration(video.duration);
        resolve(true);
      };
      video.onerror = () => resolve(false);
    });
    video.src = this.url;
    return this.videoReady;
  }

  private async extract(seconds: number): Promise<Blob | null> {
    const ready = await this.ensureVideo();
    const video = this.video;
    if (!ready || !video || this.disposed) return null;

    const target = Math.min(Math.max(0, seconds), Math.max(0, (video.duration || this.duration) - 0.05));
    const seeked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { video.onseeked = null; resolve(false); }, SEEK_TIMEOUT_MS);
      video.onseeked = () => { clearTimeout(timer); video.onseeked = null; resolve(true); };
      video.currentTime = target;
    });
    if (!seeked || this.disposed) return null;

    const height = FRAME_HEIGHT;
    const width = Math.max(1, Math.round(height * this.aspect));
    const canvas = this.canvas ?? (this.canvas = document.createElement("canvas"));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    // Synchronous encode: toBlob runs in idle time, which a hidden or minimized window
    // throttles to about one frame per second. These frames are tiny, so this costs a few ms.
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: "image/jpeg" });
    } catch {
      return null;
    }
  }
}

// ---------- Current video ----------

let current: FilmstripSource | null = null;

/** Returns the frame source for this video, replacing the previous one when the video changes. */
export const getFilmstripSource = (videoKey: string, url: string, duration: number, isPlaying: () => boolean) => {
  if (current && current.videoKey === videoKey && current.url === url) {
    current.setDuration(duration);
    return current;
  }
  current?.dispose();
  current = new FilmstripSource(videoKey, url, duration, isPlaying);
  return current;
};
