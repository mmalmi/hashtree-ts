use tauri::Manager;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing with env filter (RUST_LOG=iris_files=debug)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("iris_files=info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create data dir");

            info!("App data directory: {:?}", data_dir);

            // Check if launched with --minimized flag (from autostart) - desktop only
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.contains(&"--minimized".to_string()) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.minimize();
                        info!("Started minimized (autostart)");
                    }
                }
            }

            // Add notification plugin
            app.handle().plugin(tauri_plugin_notification::init())?;

            // Add opener plugin for external links
            app.handle().plugin(tauri_plugin_opener::init())?;

            // Add dialog plugin for file operations
            app.handle().plugin(tauri_plugin_dialog::init())?;

            // Add autostart plugin for desktop platforms
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
