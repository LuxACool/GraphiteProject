fn main() {
    // Tauri's `generate_context!()` expects Cargo's build-script environment,
    // and Tauri uses the `mobile` cfg for its mobile entry point.
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    tauri_build::build();
}
