//! Native export: runs the bundled ffmpeg.exe directly on the source file and writes the
//! result straight into the export folder. No size or memory limit (the old ffmpeg.wasm
//! engine had to copy the whole video into a 2 GB WebAssembly heap) and it uses every CPU
//! core, or the GPU encoder when the driver supports it.
//!
//! Nothing is left behind: a failed or cancelled export deletes its partial file, and the
//! temporary copies of videos that were opened without a disk path are deleted after the
//! export and swept again on every start.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use base64::Engine;

const EXPORT_FOLDER_NAME: &str = "Exportaciones de Flowuana";
const TEMP_FOLDER_NAME: &str = "flowuana-render";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static RUNNING: Mutex<Option<Child>> = Mutex::new(None);
static CANCELLED: Mutex<bool> = Mutex::new(false);
static VIDEO_ENCODER: OnceLock<&'static str> = OnceLock::new();

fn ffmpeg_command() -> Result<Command, String> {
  let exe_dir = std::env::current_exe()
    .map_err(|e| e.to_string())?
    .parent()
    .map(Path::to_path_buf)
    .ok_or("No se encontro la carpeta de la aplicacion.")?;
  let candidates = [
    exe_dir.join("ffmpeg.exe"),
    exe_dir.join("ffmpeg-x86_64-pc-windows-msvc.exe"),
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg-x86_64-pc-windows-msvc.exe"),
  ];
  let path = candidates
    .iter()
    .find(|p| p.is_file())
    .ok_or("No se encontro ffmpeg.exe junto a la aplicacion. Reinstala Flowuana.")?;
  let mut cmd = Command::new(path);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  cmd.stdin(Stdio::null());
  Ok(cmd)
}

fn encoder_args(encoder: &str) -> Vec<&'static str> {
  match encoder {
    "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "21", "-b:v", "0", "-pix_fmt", "yuv420p"],
    "h264_qsv" => vec!["-c:v", "h264_qsv", "-preset", "faster", "-global_quality", "21", "-pix_fmt", "nv12"],
    "h264_amf" => vec!["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "21", "-qp_p", "21", "-pix_fmt", "yuv420p"],
    _ => vec!["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p"],
  }
}

/// First GPU encoder that actually opens on this machine (driver present and new enough),
/// otherwise libx264 on the CPU. Checked once per run of the app.
fn pick_video_encoder() -> &'static str {
  VIDEO_ENCODER.get_or_init(|| {
    for encoder in ["h264_nvenc", "h264_qsv", "h264_amf"] {
      let Ok(mut cmd) = ffmpeg_command() else { break };
      cmd.args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=0.3"]);
      cmd.args(encoder_args(encoder));
      cmd.args(["-f", "null", "-"]).stdout(Stdio::null()).stderr(Stdio::null());
      if cmd.status().map(|s| s.success()).unwrap_or(false) {
        return encoder;
      }
    }
    "libx264"
  })
}

fn export_folder() -> Result<PathBuf, String> {
  let base = tauri::api::path::video_dir()
    .or_else(tauri::api::path::document_dir)
    .ok_or("No se encontro la carpeta Videos.")?;
  let folder = base.join(EXPORT_FOLDER_NAME);
  std::fs::create_dir_all(&folder).map_err(|e| format!("No se pudo crear la carpeta de exportacion: {}", e))?;
  Ok(folder)
}

fn temp_folder() -> PathBuf {
  std::env::temp_dir().join(TEMP_FOLDER_NAME)
}

/// Deletes temporary copies left by an export that never finished (app closed mid-render).
pub fn clean_temp_folder() {
  let _ = std::fs::remove_dir_all(temp_folder());
}

#[tauri::command]
pub fn probe_has_audio(path: String) -> Result<bool, String> {
  let output = ffmpeg_command()?
    .args(["-hide_banner", "-i", &path])
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .output()
    .map_err(|e| format!("No se pudo ejecutar ffmpeg: {}", e))?;
  let info = String::from_utf8_lossy(&output.stderr);
  Ok(info.lines().any(|line| line.trim_start().starts_with("Stream #") && line.contains("Audio:")))
}

#[derive(serde::Deserialize)]
pub struct RenderInput {
  pub start: f64,
  pub duration: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
  pub input_path: String,
  pub inputs: Vec<RenderInput>,
  pub filter: String,
  pub maps: Vec<String>,
  /// "mp4", "mp4-muted" or "mp3"
  pub format: String,
  pub total_duration: f64,
  pub file_name: String,
}

#[derive(Clone, serde::Serialize)]
struct RenderProgress {
  ratio: f64,
}

fn build_args(job: &RenderJob, output: &Path, encoder: &str) -> Vec<String> {
  let mut args: Vec<String> = ["-hide_banner", "-nostats", "-y", "-progress", "pipe:1"]
    .iter()
    .map(|s| s.to_string())
    .collect();
  for input in &job.inputs {
    args.extend([
      "-ss".into(), format!("{:.3}", input.start),
      "-t".into(), format!("{:.3}", input.duration),
      "-i".into(), job.input_path.clone(),
    ]);
  }
  args.extend(["-filter_complex".into(), job.filter.clone()]);
  for map in &job.maps {
    args.extend(["-map".into(), map.clone()]);
  }
  if job.format == "mp3" {
    args.extend(["-c:a", "libmp3lame", "-q:a", "2"].iter().map(|s| s.to_string()));
  } else {
    args.extend(encoder_args(encoder).iter().map(|s| s.to_string()));
    if job.format != "mp4-muted" {
      args.extend(["-c:a", "aac", "-b:a", "192k"].iter().map(|s| s.to_string()));
    }
    args.extend(["-movflags", "+faststart"].iter().map(|s| s.to_string()));
  }
  args.push(output.to_string_lossy().to_string());
  args
}

fn run_ffmpeg(window: &tauri::Window, args: &[String], total_duration: f64) -> Result<(), String> {
  let mut child = ffmpeg_command()?
    .args(args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("No se pudo iniciar ffmpeg: {}", e))?;

  let stdout = child.stdout.take().ok_or("ffmpeg sin salida")?;
  let mut stderr = child.stderr.take().ok_or("ffmpeg sin salida de errores")?;
  let stderr_reader = std::thread::spawn(move || {
    let mut text = String::new();
    let _ = stderr.read_to_string(&mut text);
    text
  });
  *RUNNING.lock().unwrap() = Some(child);

  for line in BufReader::new(stdout).lines().map_while(Result::ok) {
    if let Some(us) = line.strip_prefix("out_time_us=") {
      if let Ok(us) = us.trim().parse::<f64>() {
        let ratio = if total_duration > 0.0 { (us / 1_000_000.0 / total_duration).clamp(0.0, 1.0) } else { 0.0 };
        let _ = window.emit("render-progress", RenderProgress { ratio });
      }
    }
  }

  let status = RUNNING
    .lock()
    .unwrap()
    .take()
    .map(|mut c| c.wait())
    .transpose()
    .map_err(|e| e.to_string())?;
  let log = stderr_reader.join().unwrap_or_default();

  if *CANCELLED.lock().unwrap() {
    return Err("CANCELADO".into());
  }
  match status {
    Some(s) if s.success() => Ok(()),
    _ => {
      let tail: Vec<&str> = log.lines().rev().filter(|l| !l.trim().is_empty()).take(6).collect();
      Err(tail.into_iter().rev().collect::<Vec<_>>().join("\n"))
    }
  }
}

#[tauri::command]
pub async fn render_video(window: tauri::Window, job: RenderJob) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    *CANCELLED.lock().unwrap() = false;
    let clean_name = Path::new(&job.file_name)
      .file_name()
      .and_then(|n| n.to_str())
      .ok_or("Nombre de archivo invalido.")?
      .to_string();
    let output = export_folder()?.join(clean_name);

    let mut encoder = if job.format == "mp3" { "libx264" } else { pick_video_encoder() };
    let mut result = run_ffmpeg(&window, &build_args(&job, &output, encoder), job.total_duration);
    // A GPU encoder can still refuse a specific size or format: retry once on the CPU.
    if matches!(&result, Err(e) if e != "CANCELADO") && encoder != "libx264" && job.format != "mp3" {
      encoder = "libx264";
      result = run_ffmpeg(&window, &build_args(&job, &output, encoder), job.total_duration);
    }

    match result {
      Ok(()) => Ok(output.to_string_lossy().to_string()),
      Err(e) => {
        let _ = std::fs::remove_file(&output);
        Err(e)
      }
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_render() {
  *CANCELLED.lock().unwrap() = true;
  if let Some(child) = RUNNING.lock().unwrap().as_mut() {
    let _ = child.kill();
  }
}

/// Videos opened from a file picker have no disk path; ffmpeg needs one, so the page
/// streams them here in chunks. The copy is deleted by `temp_delete` after the export.
#[tauri::command]
pub fn temp_create(extension: String) -> Result<String, String> {
  let folder = temp_folder();
  std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
  let ext: String = extension.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
  let stamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  let path = folder.join(format!("entrada-{}.{}", stamp, if ext.is_empty() { "mp4" } else { &ext }));
  std::fs::File::create(&path).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().to_string())
}

fn inside_temp_folder(path: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(path);
  if path.parent() != Some(temp_folder().as_path()) {
    return Err("Ruta temporal invalida.".into());
  }
  Ok(path)
}

#[tauri::command]
pub fn temp_append(path: String, base64_chunk: String) -> Result<(), String> {
  let path = inside_temp_folder(&path)?;
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(base64_chunk)
    .map_err(|e| e.to_string())?;
  let mut file = std::fs::OpenOptions::new().append(true).open(path).map_err(|e| e.to_string())?;
  file.write_all(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn temp_delete(path: String) -> Result<(), String> {
  let path = inside_temp_folder(&path)?;
  let _ = std::fs::remove_file(path);
  Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
  if !Path::new(&path).exists() {
    return Err("El archivo ya no existe.".into());
  }
  let mut cmd = Command::new("explorer");
  // explorer.exe needs exactly `/select,"C:\a b\c.mp4"`: the default Rust quoting wraps the
  // whole argument (`"/select,C:\a b\c.mp4"`), which explorer ignores and opens Documents
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")));
  }
  cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Called once at startup: sweeps leftovers and picks the encoder in the background so the
/// first export does not wait for the GPU check.
pub fn init() {
  clean_temp_folder();
  std::thread::spawn(pick_video_encoder);
}
