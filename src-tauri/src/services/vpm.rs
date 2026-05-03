use serde_json::{json, Value};

pub struct VpmPackageEntry {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub zip_path: String,
}

/// Genera el contenido del package.json VPM para un paquete custom.
/// `zip_path` es la ruta absoluta al .zip en disco.
pub fn generate_package_json(
    name: &str,
    display_name: &str,
    version: &str,
    description: &str,
    zip_path: &str,
) -> String {
    let file_url = path_to_file_url(zip_path);
    let v: Value = json!({
        "name": name,
        "displayName": display_name,
        "version": version,
        "unity": "2022.3",
        "description": description,
        "dependencies": {},
        "url": file_url
    });
    serde_json::to_string_pretty(&v).unwrap()
}

/// Genera el JSON del índice VPM local a partir de la lista de paquetes.
/// `index_path` es la ruta donde se guardará el archivo (se incluye como `url`).
pub fn build_local_index(packages: &[VpmPackageEntry], index_path: &str) -> String {
    let mut pkgs_map = serde_json::Map::new();

    for pkg in packages {
        let file_url = path_to_file_url(&pkg.zip_path);
        let version_entry = json!({
            "name": pkg.name,
            "displayName": pkg.display_name,
            "version": pkg.version,
            "unity": "2022.3",
            "description": pkg.description,
            "dependencies": {},
            "url": file_url
        });
        let mut versions = serde_json::Map::new();
        versions.insert(pkg.version.clone(), version_entry);
        pkgs_map.insert(pkg.name.clone(), json!({ "versions": versions }));
    }

    let index: Value = json!({
        "name": "VRC Studio Local",
        "id": "dev.vrcstudio.local",
        "url": path_to_file_url(index_path),
        "author": { "name": "VRC Studio" },
        "packages": pkgs_map
    });
    serde_json::to_string_pretty(&index).unwrap()
}

/// Convierte una ruta de archivo en una URL file:///
/// Normaliza separadores en Windows (backslash → forward slash).
fn path_to_file_url(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        // Windows: "C:/foo/bar" → "file:///C:/foo/bar"
        format!("file:///{}", normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_package_json_contains_required_fields() {
        let json = generate_package_json(
            "com.user.test",
            "Test Package",
            "1.0.0",
            "A test package",
            "/tmp/com.user.test-1.0.0.zip",
        );
        assert!(json.contains("\"name\": \"com.user.test\""));
        assert!(json.contains("\"displayName\": \"Test Package\""));
        assert!(json.contains("\"version\": \"1.0.0\""));
        assert!(json.contains("\"unity\": \"2022.3\""));
        assert!(json.contains("file://"));
    }

    #[test]
    fn local_index_contains_package() {
        let pkg = VpmPackageEntry {
            name: "com.user.test".into(),
            display_name: "Test Package".into(),
            version: "1.0.0".into(),
            description: "desc".into(),
            zip_path: "/tmp/com.user.test-1.0.0.zip".into(),
        };
        let index = build_local_index(&[pkg], "/tmp/local-index.json");
        assert!(index.contains("\"com.user.test\""));
        assert!(index.contains("\"1.0.0\""));
    }

    #[test]
    fn path_to_file_url_handles_unix() {
        assert_eq!(path_to_file_url("/tmp/foo.zip"), "file:///tmp/foo.zip");
    }

    #[test]
    fn path_to_file_url_handles_windows() {
        assert_eq!(
            path_to_file_url("C:\\Users\\user\\pkg.zip"),
            "file:///C:/Users/user/pkg.zip"
        );
    }
}