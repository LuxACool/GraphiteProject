use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub runtime: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    SystemInfo {
        runtime: "tauri",
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}
