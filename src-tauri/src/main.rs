// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[cfg(windows)]
fn register_file_associations() -> Result<(), Box<dyn std::error::Error>> {
  use winreg::enums::*;
  use winreg::RegKey;

  let exe_path = std::env::current_exe()?;
  let exe_str = exe_path.to_str().unwrap_or_default();
  
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let base_path = "Software\\Classes";
  
  // 1. Create ProgID for the application
  let prog_id = "FG_Repro.Video";
  let (key, _) = hkcu.create_subkey(format!("{}\\{}", base_path, prog_id))?;
  key.set_value("", &"Video File handled by FG Repro")?;
  
  // 2. Set the DefaultIcon (use the exe's embedded icon)
  let (icon_key, _) = key.create_subkey("DefaultIcon")?;
  icon_key.set_value("", &format!("\"{}\",0", exe_str))?;
  
  // 3. Set the "Open with" command
  let (shell_key, _) = key.create_subkey("shell\\open\\command")?;
  shell_key.set_value("", &format!("\"{}\" \"%1\"", exe_str))?;

  // 4. Associate video extensions with the ProgID
  let extensions = vec![
    "mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "wmv",
    "mpg", "mpeg", "3gp", "ogv", "ts", "mts", "m2ts", "vob",
    "divx", "f4v", "asf", "rm", "rmvb", "3g2", "mxf", "dv",
  ];
  for ext in extensions {
    let ext_path = format!("{}\\.{}", base_path, ext);
    let (ext_key, _) = hkcu.create_subkey(&ext_path)?;
    ext_key.set_value("", &prog_id)?;
    
    // Also register in OpenWithProgids for modern Windows
    let (owp_key, _) = ext_key.create_subkey("OpenWithProgids")?;
    owp_key.set_value(prog_id, &"")?;
  }

  // 5. Notify the Windows Shell that file associations changed
  notify_shell_change();

  Ok(())
}

#[cfg(windows)]
fn notify_shell_change() {
  use std::ptr;
  #[link(name = "shell32")]
  extern "system" {
    fn SHChangeNotify(wEventId: i32, uFlags: u32, dwItem1: *const std::ffi::c_void, dwItem2: *const std::ffi::c_void);
  }
  const SHCNE_ASSOCCHANGED: i32 = 0x08000000;
  const SHCNF_IDLIST: u32 = 0x0000;
  unsafe {
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, ptr::null(), ptr::null());
  }
}

#[tauri::command]
fn get_initial_path() -> Option<String> {
  let args: Vec<String> = std::env::args().collect();
  if args.len() > 1 {
    Some(args[1].clone())
  } else {
    None
  }
}

#[tauri::command]
fn allow_file_access(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
  let file_path = std::path::PathBuf::from(&path);
  app_handle.asset_protocol_scope()
    .allow_file(&file_path)
    .map_err(|e| format!("Failed to allow file access: {}", e))?;
  if let Some(parent) = file_path.parent() {
    let _ = app_handle.asset_protocol_scope().allow_directory(parent, false);
  }
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      println!("{}, {argv:?}, {_cwd}", app.package_info().name);
      
      // Allow file access for the new path before sending to frontend
      if argv.len() > 1 {
        let path = std::path::PathBuf::from(&argv[1]);
        let _ = app.asset_protocol_scope().allow_file(&path);
        if let Some(parent) = path.parent() {
          let _ = app.asset_protocol_scope().allow_directory(parent, false);
        }
      }
      
      app.emit_all("path-selected", argv).unwrap();
    }))
    .invoke_handler(tauri::generate_handler![get_initial_path, allow_file_access])
    .setup(|app| {
      // Register associations on Windows
      #[cfg(windows)]
      {
        if let Err(e) = register_file_associations() {
          eprintln!("Failed to register file associations: {}", e);
        }
      }

      let args: Vec<String> = std::env::args().collect();
      if args.len() > 1 {
        let path = args[1].clone();
        
        // CRITICAL: Add the file to the asset scope BEFORE sending to frontend
        let file_path = std::path::PathBuf::from(&path);
        let _ = app.asset_protocol_scope().allow_file(&file_path);
        if let Some(parent) = file_path.parent() {
          let _ = app.asset_protocol_scope().allow_directory(parent, false);
        }
        
        app.emit_all("path-selected", vec![path]).unwrap();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
