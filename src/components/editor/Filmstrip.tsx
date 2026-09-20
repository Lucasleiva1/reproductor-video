import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTimeline, type Clip } from "@/hooks/useTimeline";
import { getClipDuration } from "@/utils/timeline";
import { DEFAULT_ASPECT, frameKeyFor, getFilmstripSource, type FilmstripSource } from "@/utils/filmstrip";

const STRIP_HEIGHT = 46;

const hasTauriIpc = () =>
  typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === "function" &&
  "__TAURI_METADATA__" in window;

/**
 * Frame source for the loaded video. The cache key identifies the file itself (path + size + date,
 * or name + size + date for dropped files), so the same video reuses its frames across sessions.
 */
export function useFilmstripSource(): FilmstripSource | null {
  const videoUrl = useTimeline((s) => s.videoUrl);
  const videoPath = useTimeline((s) => s.videoPath);
  const videoFile = useTimeline((s) => s.videoFile);
  const sourceDuration = useTimeline((s) => s.clips[0]?.sourceDuration ?? 0);
  const [videoKey, setVideoKey] = useState<{ url: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!videoUrl) {
      setVideoKey(null);
      return;
    }
    // Same shape for a picked file and for a path opened from Windows (name + size + modified ms),
    // so one video shares its cached frames however it was opened.
    const resolveKey = async () => {
      if (videoFile) return `video:${videoFile.name}:${videoFile.size}-${videoFile.lastModified}`;
      if (videoPath && hasTauriIpc()) {
        const name = videoPath.split(/[\\/]/).pop() ?? videoPath;
        try {
          const { invoke } = await import("@tauri-apps/api/tauri");
          const fingerprint = await invoke<string>("file_fingerprint", { path: videoPath });
          return `video:${name}:${fingerprint}`;
        } catch {
          return `path:${videoPath}`;
        }
      }
      return `url:${videoUrl}`;
    };
    resolveKey().then((key) => {
      if (!cancelled) setVideoKey({ url: videoUrl, key });
    });
    return () => { cancelled = true; };
  }, [videoUrl, videoPath, videoFile]);

  const source = useMemo(() => {
    if (!videoKey || videoKey.url !== videoUrl || sourceDuration <= 0) return null;
    return getFilmstripSource(videoKey.key, videoKey.url, sourceDuration, () => useTimeline.getState().playing);
  }, [videoKey, videoUrl, sourceDuration]);

  // Only work while the timeline is on screen.
  useEffect(() => {
    if (!source) return;
    source.setActive(true);
    return () => source.setActive(false);
  }, [source]);

  return source;
}

const noopSubscribe = () => () => {};
const zero = () => 0;

interface FilmstripTilesProps {
  source: FilmstripSource | null;
  clip: Clip;
  clipStartPx: number;
  clipWidthPx: number;
  pixelsPerSecond: number;
  /** Track-space range worth rendering (visible area plus a margin). */
  viewStartPx: number;
  viewEndPx: number;
}

/**
 * Filmstrip like an NLE: every tile keeps the video's aspect ratio (never stretched or cropped),
 * zooming in adds tiles instead of widening them, and only tiles near the viewport are rendered.
 */
export function FilmstripTiles({ source, clip, clipStartPx, clipWidthPx, pixelsPerSecond, viewStartPx, viewEndPx }: FilmstripTilesProps) {
  useSyncExternalStore(source?.subscribe ?? noopSubscribe, source?.getVersion ?? zero);

  const aspect = source?.aspect ?? DEFAULT_ASPECT;
  const tileWidth = Math.max(24, Math.round(STRIP_HEIGHT * aspect));
  const secondsPerTile = tileWidth / Math.max(0.0001, pixelsPerSecond);
  const clipDuration = getClipDuration(clip);
  const tileCount = Math.max(1, Math.ceil(clipWidthPx / tileWidth));

  const localStart = Math.max(0, viewStartPx - clipStartPx);
  const localEnd = Math.min(clipWidthPx, viewEndPx - clipStartPx);
  const firstTile = Math.max(0, Math.floor(localStart / tileWidth));
  const lastTile = Math.min(tileCount - 1, Math.ceil(localEnd / tileWidth) - 1);

  const tiles: { index: number; key: number }[] = [];
  for (let i = firstTile; i <= lastTile; i++) {
    const center = clip.trimStart + Math.min(clipDuration, (i + 0.5) * secondsPerTile);
    tiles.push({ index: i, key: frameKeyFor(center, secondsPerTile, clip.sourceDuration) });
  }

  // Ask for the frames of the tiles closest to the middle of the view first.
  const middleTile = (localStart + localEnd) / 2 / tileWidth;
  const wantedKeys = [...tiles]
    .sort((a, b) => Math.abs(a.index - middleTile) - Math.abs(b.index - middleTile))
    .map((tile) => tile.key);
  const wantedSignature = wantedKeys.join(",");

  useEffect(() => {
    if (!source) return;
    source.setWanted(clip.id, wantedSignature ? wantedSignature.split(",").map(Number) : []);
  }, [source, clip.id, wantedSignature]);

  useEffect(() => {
    if (!source) return;
    return () => source.setWanted(clip.id, []);
  }, [source, clip.id]);

  return (
    <div
      className="absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden bg-zinc-950 ring-1 ring-black pointer-events-none"
      style={{ height: STRIP_HEIGHT }}
    >
      {tiles.map(({ index, key }) => {
        const url = source?.frameUrl(key) ?? null;
        return (
          <div
            key={index}
            className="absolute top-0 h-full overflow-hidden border-r border-black bg-zinc-900"
            style={{ left: index * tileWidth, width: tileWidth }}
          >
            {url && (
              <img
                src={url}
                alt=""
                draggable={false}
                decoding="async"
                className="h-full w-full select-none object-cover"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
