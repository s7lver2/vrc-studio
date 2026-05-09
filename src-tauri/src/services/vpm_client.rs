use crate::error::AppError;
use crate::models::{VpmPackage, VpmPackageVersion};
use serde_json::Value;
use std::collections::HashMap;

fn get_str<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a str> {
    for key in keys {
        if let Some(v) = obj.get(key).and_then(|v| v.as_str()) {
            return Some(v);
        }
    }
    None
}

fn get_string_map(obj: &Value, keys: &[&str]) -> HashMap<String, String> {
    for key in keys {
        if let Some(deps) = obj.get(key).and_then(|v| v.as_object()) {
            return deps
                .iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                .collect();
        }
    }
    HashMap::new()
}

/// Convert a raw serde_json object (map) of package-id → {versions:{...}} into
/// our domain types.  Bad individual entries are silently skipped.
fn parse_packages_map(
    map: &serde_json::Map<String, Value>,
) -> Vec<VpmPackage> {
    let mut result = Vec::with_capacity(map.len());
    for (pkg_id, pkg_entry) in map {
        let versions_obj = match pkg_entry
            .get("versions")
            .or_else(|| pkg_entry.get("Versions"))
            .and_then(|v| v.as_object())
        {
            Some(v) => v,
            None => continue,
        };

        let mut versions: HashMap<String, VpmPackageVersion> =
            HashMap::with_capacity(versions_obj.len());

        for (ver_str, ver_obj) in versions_obj {
            let name = match get_str(ver_obj, &["name"]) {
                Some(v) => v.to_owned(),
                None => continue,
            };
            let url = match get_str(ver_obj, &["url"]) {
                Some(v) => v.to_owned(),
                None => continue,
            };
            let version = get_str(ver_obj, &["version"])
                .map(str::to_owned)
                .unwrap_or_else(|| ver_str.clone());
            let display_name = get_str(ver_obj, &["displayName", "display_name"])
                .unwrap_or(&name)
                .to_owned();
            let unity = get_str(ver_obj, &["unity", "unityVersion", "unityMinimum"])
                .unwrap_or("2022.3")
                .to_owned();
            let description = get_str(ver_obj, &["description"]).map(str::to_owned);
            let dependencies =
                get_string_map(ver_obj, &["dependencies", "vpmDependencies"]);

            versions.insert(
                ver_str.clone(),
                VpmPackageVersion {
                    name,
                    display_name,
                    version,
                    unity,
                    description,
                    url,
                    dependencies,
                    changelog_url: None,
                    documentation_url: None,
                    license_url: None,
                    samples: vec![],
                },
            );
        }

        if !versions.is_empty() {
            result.push(VpmPackage { id: pkg_id.clone(), versions });
        }
    }
    result
}

/// Parse a VPM repository index JSON into a list of VpmPackage.
///
/// Handles several root-level shapes:
///  1. `{ "packages": { ... } }` — standard VPM repo object
///  2. `{ "Packages": { ... } }` — capital-P variant
///  3. `[ { "id": ..., "versions": ... }, ... ]` — bare array of package entries
///  4. Any top-level object where a value is itself a {versions:{}} map
///     (last-resort heuristic so we degrade gracefully if VRChat changes format)
pub fn parse_vpm_index(json: &str) -> Result<Vec<VpmPackage>, AppError> {
    let root: Value = serde_json::from_str(json)
        .map_err(|e| AppError::External(format!("VPM index is not valid JSON: {e}")))?;

    // ── Case 1 & 2: standard { "packages": {...} } ────────────────────────
    if let Some(map) = root
        .get("packages")
        .or_else(|| root.get("Packages"))
        .and_then(|v| v.as_object())
    {
        let result = parse_packages_map(map);
        if !result.is_empty() {
            return Ok(result);
        }
    }

    // ── Case 3: bare JSON array of package entries ─────────────────────────
    if let Some(arr) = root.as_array() {
        let mut result = Vec::new();
        for entry in arr {
            if let (Some(id), Some(_versions_obj)) = (
                entry.get("id").and_then(|v| v.as_str()),
                entry.get("versions").and_then(|v| v.as_object()),
            ) {
                let mut single = serde_json::Map::new();
                single.insert(id.to_owned(), entry.clone());
                result.extend(parse_packages_map(&single));
            }
        }
        if !result.is_empty() {
            return Ok(result);
        }
    }

    // ── Case 4: heuristic — scan every root value for a {versions} shape ──
    if let Some(root_obj) = root.as_object() {
        for (_key, val) in root_obj {
            if let Some(inner) = val.as_object() {
                // Looks like a packages map if its values contain "versions"
                let looks_like_packages = inner
                    .values()
                    .any(|v| v.get("versions").and_then(|v| v.as_object()).is_some());
                if looks_like_packages {
                    let result = parse_packages_map(inner);
                    if !result.is_empty() {
                        return Ok(result);
                    }
                }
            }
        }

        // If the API returned { "error": ... }, surface it directly.
        // The value may be a string, object, or anything — handle all cases.
        if let Some(err_val) = root_obj.get("error") {
            let msg = err_val
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| err_val.to_string());
            eprintln!("[VPM] server returned error field: {}", msg);
            return Err(AppError::External(format!(
                "VPM repository returned an error: {msg}"
            )));
        }

        // Build a useful error: tell the caller what root keys ARE present
        let root_keys: Vec<&str> = root_obj.keys().map(String::as_str).collect();
        eprintln!("[VPM] unrecognised format — root keys: {:?}", root_keys);
        return Err(AppError::External(format!(
            "VPM index has an unrecognised format. Root keys found: [{}]. \
             Expected a '\"packages\"' object but none matched.",
            root_keys.join(", ")
        )));
    }

    Err(AppError::External(
        "VPM index has an unrecognised format (root is neither an object nor an array).".to_string(),
    ))
}

pub async fn fetch_vpm_repository(url: &str) -> Result<Vec<VpmPackage>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("VRC-Studio/1.0 (vrc-studio; https://github.com/vrc-studio)")
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    eprintln!("[VPM] ▶ fetching index from: {}", url);

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[VPM] ✗ HTTP request failed: {}", e);
            AppError::External(format!("HTTP error: {e}"))
        })?;

    let status = response.status();
    eprintln!(
        "[VPM] ← HTTP {} {}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("")
    );

    let body = response
        .text()
        .await
        .map_err(|e| {
            eprintln!("[VPM] ✗ failed to read response body: {}", e);
            AppError::External(format!("Body error: {e}"))
        })?;

    eprintln!("[VPM]   body size: {} bytes", body.len());

    // Log full body on non-2xx (usually short error payloads); preview only on success.
    if !status.is_success() {
        let preview = if body.len() > 1000 { &body[..1000] } else { &body };
        eprintln!("[VPM] ✗ non-success response body:\n{}", preview);
    } else {
        let preview = if body.len() > 500 { &body[..500] } else { &body };
        eprintln!("[VPM]   body preview:\n{}", preview);
    }

    let result = parse_vpm_index(&body);
    match &result {
        Ok(pkgs) => eprintln!("[VPM] ✓ parsed {} packages ok", pkgs.len()),
        Err(e)   => eprintln!("[VPM] ✗ parse error: {}", e),
    }
    result
}