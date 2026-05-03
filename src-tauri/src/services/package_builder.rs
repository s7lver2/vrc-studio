use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

/// Error type del builder.
#[derive(Debug)]
pub enum BuildError {
    Io(io::Error),
    Zip(zip::result::ZipError),
    AssetNotFound(String),
}

impl From<io::Error> for BuildError {
    fn from(e: io::Error) -> Self {
        BuildError::Io(e)
    }
}

impl From<zip::result::ZipError> for BuildError {
    fn from(e: zip::result::ZipError) -> Self {
        BuildError::Zip(e)
    }
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::Io(e) => write!(f, "IO error: {e}"),
            BuildError::Zip(e) => write!(f, "ZIP error: {e}"),
            BuildError::AssetNotFound(p) => write!(f, "Asset not found: {p}"),
        }
    }
}

/// Construye un ZIP VPM que contiene:
/// - `package.json` en la raíz
/// - Cada archivo en `asset_paths` con su nombre de archivo original (sin subcarpetas)
///
/// `out_path` es la ruta absoluta donde se escribe el ZIP.
pub fn build_zip(
    package_json: &str,
    asset_paths: &[String],
    out_path: &str,
) -> Result<(), BuildError> {
    // Crear directorio padre si no existe
    if let Some(parent) = Path::new(out_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(out_path)?;
    let mut zip = ZipWriter::new(file);
    let options =
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // Escribir package.json en la raíz del ZIP
    zip.start_file("package.json", options)?;
    zip.write_all(package_json.as_bytes())?;

    // Añadir cada asset con su nombre de archivo original
    for asset_path in asset_paths {
        let path = Path::new(asset_path);
        if !path.exists() {
            return Err(BuildError::AssetNotFound(asset_path.clone()));
        }
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("asset");
        let content = fs::read(path)?;
        zip.start_file(file_name, options)?;
        zip.write_all(&content)?;
    }

    zip.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn build_creates_zip_with_package_json() {
        let dir = tempdir().unwrap();
        let asset_path = dir.path().join("myasset.unitypackage");
        fs::write(&asset_path, b"fake unity package content").unwrap();

        let out_zip = dir.path().join("output.zip");
        let package_json = r#"{"name":"com.u.test","version":"1.0.0"}"#;

        build_zip(
            package_json,
            &[asset_path.to_str().unwrap().to_string()],
            out_zip.to_str().unwrap(),
        )
        .unwrap();

        assert!(out_zip.exists());

        // Verificar que el ZIP contiene package.json
        let file = fs::File::open(&out_zip).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"package.json".to_string()));
        assert!(names.contains(&"myasset.unitypackage".to_string()));
    }

    #[test]
    fn build_zip_no_assets() {
        let dir = tempdir().unwrap();
        let out_zip = dir.path().join("empty.zip");
        build_zip(r#"{"name":"x"}"#, &[], out_zip.to_str().unwrap()).unwrap();
        assert!(out_zip.exists());
    }
}