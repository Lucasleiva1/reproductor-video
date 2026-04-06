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
  
  // 2. Set the "Open with" command
  let (shell_key, _) = key.create_subkey("shell\\open\\command")?;
  shell_key.set_value("", &format!("\"{}\" \"%1\"", exe_str))?;

  // 3. Associate video extensions with the ProgID
  let extensions = vec!["mp4", "mkv", "avi", "mov", "webm"];
  for ext in extensions {
    let ext_path = format!("{}\\.{}", base_path, ext);
    let (ext_key, _) = hkcu.create_subkey(&ext_path)?;
    ext_key.set_value("", &prog_id)?;
  }

  Ok(())
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

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
      println!("{}, {argv:?}, {cwd}", app.package_info().name);
      app.emit_all("path-selected", argv).unwrap();
    }))
    .invoke_handler(tauri::generate_handler![get_initial_path])
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
        app.emit_all("path-selected", vec![path]).unwrap();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
