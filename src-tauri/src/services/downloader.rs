use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub fn is_zip_path(path: &str) -> bool {
    path.to_lowercase().ends_with(".zip")
}

pub fn is_unitypackage_path(path: &str) -> bool {
    path.to_lowercase().ends_with(".unitypackage")
}

/// Extrae un .unitypackage (tar.gz con estructura GUID-based) a `dest_dir`.
/// Reconstruye la jerarquía original usando los archivos `pathname` de cada entry.
/// Los paths `Assets/...` se extraen como `<dest_dir>/...` (sin el prefijo Assets/).
pub fn extract_unitypackage_to_dir(
    pkg_path: &std::path::Path,
    dest_dir: &std::path::Path,
) -> anyhow::Result<()> {
    use std::io::Read;
    use flate2::read::GzDecoder;
    use tar::Archive;

    // Paso 1 — recoger mapa guid → pathname original
    let mut pathnames: std::collections::HashMap<String, String> = Default::default();
    {
        let file = std::fs::File::open(pkg_path)?;
        let mut archive = Archive::new(GzDecoder::new(file));
        for entry in archive.entries()? {
            let mut entry = entry?;
            let entry_path = entry.path()?.into_owned();
            let parts: Vec<_> = entry_path.components().collect();
            if parts.len() < 2 { continue; }
            let guid = parts[0].as_os_str().to_string_lossy().to_string();
            let file_name = parts[parts.len() - 1].as_os_str().to_string_lossy().to_string();
            if file_name == "pathname" {
                let mut content = String::new();
                entry.read_to_string(&mut content).unwrap_or(0);
                pathnames.insert(guid, content.trim().replace('\r', "").to_string());
            }
        }
    }

    // Paso 2 — escribir cada `asset` en su ruta original (sin prefijo Assets/)
    {
        let file = std::fs::File::open(pkg_path)?;
        let mut archive = Archive::new(GzDecoder::new(file));
        for entry in archive.entries()? {
            let mut entry = entry?;
            let entry_path = entry.path()?.into_owned();
            let parts: Vec<_> = entry_path.components().collect();
            if parts.len() < 2 { continue; }
            let guid = parts[0].as_os_str().to_string_lossy().to_string();
            let file_name = parts[parts.len() - 1].as_os_str().to_string_lossy().to_string();
            if file_name == "asset" {
                if let Some(pathname) = pathnames.get(&guid) {
                    let rel = pathname.strip_prefix("Assets/").unwrap_or(pathname.as_str());
                    let out_path = dest_dir.join(rel);
                    if let Some(parent) = out_path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let mut data = Vec::new();
                    entry.read_to_end(&mut data)?;
                    std::fs::write(&out_path, &data)?;
                }
            }
        }
    }

    Ok(())
}

pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
}

impl DownloadProgress {
    pub fn new(total_bytes: u64) -> Self {
        Self {
            total_bytes,
            downloaded_bytes: 0,
        }
    }

    pub fn add_bytes(&mut self, n: u64) {
        self.downloaded_bytes += n;
    }

    pub fn percentage(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        (self.downloaded_bytes as f64 / self.total_bytes as f64) * 100.0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub item_id: String,
    pub percentage: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading" | "extracting" | "done" | "error"
}

/// Descarga `url` a `dest_dir/<filename>`.
/// Emite eventos `download://progress` con Tauri.
/// Retorna la ruta final del archivo descargado.
pub async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    item_id: &str,
    url: &str,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(0);

    // Intentar obtener el nombre del archivo del Content-Disposition o la URL
    let filename = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|cd| {
            cd.split("filename=")
                .nth(1)
                .map(|s| s.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| {
            url.split('/')
                .last()
                .map(|s| {
                    // Quitar query strings
                    s.split('?').next().unwrap_or(s).to_string()
                })
                .map(|s| sanitize_filename(&s))
                .unwrap_or_else(|| format!("{}.bin", item_id))
        });

    tokio::fs::create_dir_all(dest_dir)
        .await
        .map_err(|e| e.to_string())?;

    let dest_path = dest_dir.join(&filename);
    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut progress = DownloadProgress::new(total);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        progress.add_bytes(bytes.len() as u64);

        let _ = app.emit(
            "download://progress",
            DownloadProgressEvent {
                item_id: item_id.to_string(),
                percentage: progress.percentage(),
                downloaded_bytes: progress.downloaded_bytes,
                total_bytes: progress.total_bytes,
                status: "downloading".to_string(),
            },
        );
    }

    Ok(dest_path)
}

/// Si el archivo descargado es un .zip o .unitypackage, lo extrae en `dest_dir`.
/// Retorna el directorio de extracción (o el path del archivo si no era ninguno de los dos).
pub async fn maybe_extract_zip(
    app: &AppHandle,
    item_id: &str,
    file_path: &Path,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    let path_str = file_path.to_string_lossy();
    let is_zip = is_zip_path(&path_str);
    let is_unity = is_unitypackage_path(&path_str);

    if !is_zip && !is_unity {
        return Ok(file_path.to_path_buf());
    }

    let _ = app.emit(
        "download://progress",
        DownloadProgressEvent {
            item_id: item_id.to_string(),
            percentage: 100.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "extracting".to_string(),
        },
    );

    let file_path_owned = file_path.to_path_buf();
    let dest_dir_owned = dest_dir.to_path_buf();

    tokio::task::spawn_blocking(move || -> Result<PathBuf, String> {
        if is_zip {
            let file = std::fs::File::open(&file_path_owned).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            archive.extract(&dest_dir_owned).map_err(|e| e.to_string())?;
            std::fs::remove_file(&file_path_owned).ok();
        } else {
            // .unitypackage
            extract_unitypackage_to_dir(&file_path_owned, &dest_dir_owned)
                .map_err(|e| e.to_string())?;
            std::fs::remove_file(&file_path_owned).ok();
        }
        Ok(dest_dir_owned)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_zip_by_extension() {
        assert!(is_zip_path("/tmp/pack.zip"));
        assert!(is_zip_path("/tmp/pack.ZIP"));
        assert!(!is_zip_path("/tmp/pack.unitypackage"));
        assert!(!is_zip_path("/tmp/pack.exe"));
    }

    #[test]
    fn test_is_unitypackage_by_extension() {
        assert!(is_unitypackage_path("/tmp/pack.unitypackage"));
        assert!(is_unitypackage_path("/tmp/pack.UNITYPACKAGE"));
        assert!(!is_unitypackage_path("/tmp/pack.zip"));
        assert!(!is_unitypackage_path("/tmp/pack.exe"));
    }

    #[test]
    fn test_sanitize_filename() {
        let name = sanitize_filename("Cool Avatar/Base: v2.0?");
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
        assert!(!name.contains('?'));
        assert!(name.contains("Cool Avatar"));
    }

    #[test]
    fn test_download_progress_percentage() {
        let mut prog = DownloadProgress::new(1000);
        prog.add_bytes(500);
        assert_eq!(prog.percentage(), 50.0);
        prog.add_bytes(500);
        assert_eq!(prog.percentage(), 100.0);
    }

    #[test]
    fn test_download_progress_zero_total() {
        let prog = DownloadProgress::new(0);
        assert_eq!(prog.percentage(), 0.0);
    }
}