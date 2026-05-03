fn main() {
    // Permite compilar sin la variable de entorno en dev (con valor placeholder)
    // En producción, setear GITHUB_OAUTH_CLIENT_ID antes de `cargo tauri build`
    if std::env::var("GITHUB_OAUTH_CLIENT_ID").is_err() {
        println!("cargo:rustc-env=GITHUB_OAUTH_CLIENT_ID=Ov23liDEV00000000000");
    }
    tauri_build::build()
}