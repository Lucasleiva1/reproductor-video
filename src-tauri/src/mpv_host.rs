//! Puente entre la interfaz y el reproductor mpv (libmpv dentro de la ventana).
//!
//! libmpv viaja adentro de Flowuana: en el instalador va en la carpeta de recursos `mpv/`. Antes
//! de cargarla en la aplicación se prueba en un proceso aparte, así una compilación incompatible
//! con el procesador nunca puede tirar abajo Flowuana: en ese caso se avisa en pantalla.

use crate::mpv_engine::{
    probe_library, LibMpv, MpvCommand, MpvImage, MpvPlayer, MpvState, OpenRequest,
};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, Window};

pub const PROBE_FLAG: &str = "--flowuana-probar-libmpv";
const STATE_EVENT: &str = "mpv-state";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStatusDto {
    pub available: bool,
    pub message: Option<String>,
}

enum HostState {
    Unknown,
    Ready(Arc<MpvPlayer>),
    Unavailable(String),
}

pub struct MpvHost {
    app: AppHandle,
    library: Option<PathBuf>,
    data_dir: PathBuf,
    state: Mutex<HostState>,
}

impl MpvHost {
    pub fn new(app: AppHandle, resource_dir: Option<PathBuf>, data_dir: PathBuf) -> Self {
        Self {
            app,
            library: locate_library(resource_dir.as_deref()),
            data_dir,
            state: Mutex::new(HostState::Unknown),
        }
    }

    fn player(&self) -> Result<Arc<MpvPlayer>, String> {
        let mut state = self.state.lock();
        match &*state {
            HostState::Ready(player) => return Ok(player.clone()),
            HostState::Unavailable(message) => return Err(message.clone()),
            HostState::Unknown => {}
        }
        let result = self.prepare();
        *state = match &result {
            Ok(player) => HostState::Ready(player.clone()),
            Err(message) => HostState::Unavailable(message.clone()),
        };
        result
    }

    fn prepare(&self) -> Result<Arc<MpvPlayer>, String> {
        let library = self
            .library
            .clone()
            .ok_or_else(|| "Falta libmpv-2.dll en la carpeta de Flowuana".to_string())?;
        probe_in_child_process(&library)?;
        let lib = LibMpv::load(&library).map_err(error_string)?;
        let app = self.app.clone();
        let listener = Arc::new(move |state: MpvState| {
            let _ = app.emit_all(STATE_EVENT, state);
        });
        // Las fuentes de subtítulos (Montserrat) viajan al lado de libmpv, en su carpeta "fonts".
        let fonts_dir = library
            .parent()
            .map(|folder| folder.join("fonts"))
            .filter(|folder| folder.is_dir());
        MpvPlayer::new(lib, self.data_dir.clone(), fonts_dir, listener)
            .map(Arc::new)
            .map_err(error_string)
    }

    pub fn status(&self) -> MpvStatusDto {
        match self.player() {
            Ok(_) => MpvStatusDto {
                available: true,
                message: None,
            },
            Err(message) => MpvStatusDto {
                available: false,
                message: Some(message),
            },
        }
    }
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Solo se usa la copia que trae Flowuana. En desarrollo, además, la de la carpeta del proyecto.
fn locate_library(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(resource_dir) = resource_dir {
        let bundled = resource_dir.join("mpv").join("libmpv-2.dll");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    #[cfg(debug_assertions)]
    {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("mpv")
            .join("libmpv-2.dll");
        if project.is_file() {
            return Some(project);
        }
    }
    None
}

fn probe_in_child_process(library: &Path) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(error_string)?;
    let mut command = Command::new(executable);
    command
        .arg(PROBE_FLAG)
        .arg(library)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo probar libmpv: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "libmpv no funciona en esta computadora (código {})",
                    status.code().unwrap_or(-1)
                ));
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(40))
            }
            Ok(None) => {
                let _ = child.kill();
                return Err("La prueba de libmpv tardó demasiado".into());
            }
            Err(error) => return Err(format!("No se pudo probar libmpv: {error}")),
        }
    }
}

/// Lo ejecuta el proceso de prueba (ver `probe_in_child_process`). Devuelve el código de salida.
pub fn run_probe_if_requested() -> Option<i32> {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let mut arguments = arguments.iter();
    if arguments.next()? != PROBE_FLAG {
        return None;
    }
    let library = PathBuf::from(arguments.next()?);
    Some(match probe_library(&library) {
        Ok(_) => 0,
        Err(_) => 2,
    })
}

pub type SharedHost = Arc<MpvHost>;

#[tauri::command]
pub async fn mpv_status(host: State<'_, SharedHost>) -> Result<MpvStatusDto, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.status())
        .await
        .map_err(error_string)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mpv_open(
    path: String,
    start_seconds: f64,
    paused: bool,
    volume: f64,
    muted: bool,
    image: MpvImage,
    window: Window,
    host: State<'_, SharedHost>,
) -> Result<u64, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("El archivo de video ya no está disponible".into());
    }
    let window_handle = window.hwnd().map_err(error_string)?.0 as isize;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let player = host.player()?;
        player
            .open(OpenRequest {
                window_handle,
                path,
                start_seconds,
                paused,
                volume,
                muted,
                image,
            })
            .map_err(error_string)
    })
    .await
    .map_err(error_string)?
}

#[tauri::command]
pub async fn mpv_command(command: MpvCommand, host: State<'_, SharedHost>) -> Result<(), String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.player()?.command(command).map_err(error_string)
    })
    .await
    .map_err(error_string)?
}

#[tauri::command]
pub async fn mpv_stop(host: State<'_, SharedHost>) -> Result<(), String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.player()?.stop().map_err(error_string))
        .await
        .map_err(error_string)?
}

/// Información del video abierto: lo que sabe mpv más los datos del archivo en el disco
/// (tamaño y fechas de creación y modificación, en milisegundos desde 1970).
#[tauri::command]
pub async fn mpv_metadata(
    path: Option<String>,
    host: State<'_, SharedHost>,
) -> Result<serde_json::Value, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut info = host.player()?.metadata().map_err(error_string)?;
        let file = path.or_else(|| {
            info.get("path")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        });
        if let Some(file) = file {
            if let Ok(meta) = std::fs::metadata(&file) {
                let millis = |time: std::io::Result<std::time::SystemTime>| {
                    time.ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                };
                let mut disk = serde_json::Map::new();
                disk.insert("size".into(), meta.len().into());
                if let Some(ms) = millis(meta.created()) {
                    disk.insert("created".into(), ms.into());
                }
                if let Some(ms) = millis(meta.modified()) {
                    disk.insert("modified".into(), ms.into());
                }
                disk.insert("readOnly".into(), meta.permissions().readonly().into());
                info.insert("disk".into(), serde_json::Value::Object(disk));
            }
        }
        Ok(serde_json::Value::Object(info))
    })
    .await
    .map_err(error_string)?
}

/// Guarda el cuadro actual en la carpeta de capturas y devuelve dónde quedó.
#[tauri::command]
pub async fn mpv_screenshot(filename: String, host: State<'_, SharedHost>) -> Result<String, String> {
    let clean = Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.to_ascii_lowercase().ends_with(".png"))
        .ok_or_else(|| "Nombre de captura inválido.".to_string())?
        .to_string();
    let folder = crate::ensure_screenshot_folder()
        .map_err(|e| format!("No se pudo preparar la carpeta de capturas: {}", e))?;
    let target = folder.join(clean);
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.player()?.screenshot(&target).map_err(error_string)?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(error_string)?
}
