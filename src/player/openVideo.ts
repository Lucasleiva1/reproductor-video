/* Abrir videos desde el disco. mpv necesita la ruta del archivo, así que se usa el selector de
   archivos de Windows (y el arrastre de Tauri) en lugar del selector de la página web. */

export const VIDEO_EXTS = [
  "mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "wmv", "mpg", "mpeg", "3gp", "ogv", "ts", "mts",
  "m2ts", "vob", "divx", "f4v", "asf", "rm", "rmvb", "3g2", "mxf", "dv",
];

export const isVideoPath = (path: string) => {
  const clean = path.replace(/^["']|["']$/g, "").toLowerCase();
  return VIDEO_EXTS.some((ext) => clean.endsWith(`.${ext}`));
};

/** Muestra el selector de archivos y devuelve la ruta del video elegido (o null). */
export const pickVideoPath = async (title = "Abrir video") => {
  const { open } = await import("@tauri-apps/api/dialog");
  const chosen = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: "Videos", extensions: VIDEO_EXTS }],
  });
  if (!chosen || Array.isArray(chosen)) return null;
  return chosen;
};
