import type { Clip } from "@/hooks/useTimeline";

const TIMELINE_EPSILON = 0.001;

export const getClipDuration = (clip: Clip) =>
  Math.max(0, clip.trimEnd - clip.trimStart);

export const getClipEnd = (clip: Clip) => clip.startAt + getClipDuration(clip);

export const sortClipsByTimeline = (clips: Clip[]) =>
  [...clips].sort((a, b) => a.startAt - b.startAt);

export const getContentDuration = (clips: Clip[]) =>
  clips.reduce((max, clip) => Math.max(max, getClipEnd(clip)), 0);

export const findActiveClip = (clips: Clip[], timelineTime: number) =>
  sortClipsByTimeline(clips).find((clip) => {
    const start = clip.startAt;
    const end = getClipEnd(clip);
    return timelineTime >= start && timelineTime < end - TIMELINE_EPSILON;
  });

export const getSourceTimeForTimeline = (clip: Clip, timelineTime: number) =>
  clip.trimStart + (timelineTime - clip.startAt);

export const findNextClip = (clips: Clip[], timelineTime: number) =>
  sortClipsByTimeline(clips).find(
    (clip) => clip.startAt > timelineTime + TIMELINE_EPSILON
  );

export const rippleDeleteClip = (clips: Clip[], clipId: string) => {
  const removed = clips.find((clip) => clip.id === clipId);
  if (!removed) return clips;

  const removedStart = removed.startAt;
  const removedEnd = getClipEnd(removed);
  const removedDuration = getClipDuration(removed);

  return clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => {
      if (clip.startAt >= removedEnd) {
        return { ...clip, startAt: Math.max(removedStart, clip.startAt - removedDuration) };
      }
      return clip;
    });
};
