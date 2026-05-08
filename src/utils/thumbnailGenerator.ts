export interface GenerateOptions {
  videoUrl: string;
  duration: number;
  maxThumbnails?: number;
  thumbnailWidth?: number;
  onThumbnail?: (index: number, total: number, dataUrl: string) => void;
  shouldAbort?: () => boolean;
}

export const generateThumbnails = async ({
  videoUrl,
  duration,
  maxThumbnails = 40,
  thumbnailWidth = 100,
  onThumbnail,
  shouldAbort
}: GenerateOptions): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
    const safeResolve = (value: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const safeReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    // Mute is important to prevent autoplay policies from blocking
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Canvas context no disponible'));
      }

      // Calculate height based on video aspect ratio
      const aspect = video.videoHeight / video.videoWidth;
      canvas.width = thumbnailWidth;
      canvas.height = Math.floor(thumbnailWidth * aspect);

      const thumbnails: string[] = [];
      const numThumbnails = maxThumbnails;
      const step = duration / numThumbnails;
      let currentIndex = 0;

      const captureFrame = () => {
        if (shouldAbort?.()) {
          safeResolve(thumbnails);
          return;
        }
        if (currentIndex >= numThumbnails) {
          safeResolve(thumbnails);
          return;
        }

        // Set time. Offset slightly relative to step to avoid exact 0s issues
        video.currentTime = (currentIndex * step) + (step / 2);
      };

      video.onseeked = () => {
        if (shouldAbort?.()) {
          safeResolve(thumbnails);
          return;
        }
        // Draw the current frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Export highly compressed JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        thumbnails.push(dataUrl);

        if (onThumbnail) {
          onThumbnail(currentIndex, numThumbnails, dataUrl);
        }

        currentIndex++;

        // small pause to let the React UI render without freezing
        timeoutId = setTimeout(() => {
          captureFrame();
        }, 10);
      };

      video.onerror = (e) => {
        console.error('Error generando thumbnail:', e);
        safeReject(e);
      };

      // Iniciar el ciclo
      captureFrame();
    };
  });
};
