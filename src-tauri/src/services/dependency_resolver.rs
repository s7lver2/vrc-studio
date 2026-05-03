use crate::error::AppError;
use crate::models::{VpmPackage, VpmPackageVersion};
use std::collections::{HashMap, HashSet};

/// Packages whose ID starts with these prefixes are managed by Unity's own
/// Package Manager registry, not by VPM.  The VRChat SDK lists them as
/// dependencies but they will never appear in the VPM index — skip them
/// silently so we don't error out trying to install them via VPM.
const UNITY_REGISTRY_PREFIXES: &[&str] = &[
    "com.unity.",
    "com.microsoft.",
    "com.google.",
];

fn is_unity_registry_package(id: &str) -> bool {
    UNITY_REGISTRY_PREFIXES.iter().any(|prefix| id.starts_with(prefix))
}

pub fn resolve<'a>(
    requested: &[&str],
    available: &'a [VpmPackage],
) -> Result<Vec<&'a VpmPackageVersion>, AppError> {
    let index: HashMap<&str, &VpmPackage> = available.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut resolved: HashMap<String, &'a VpmPackageVersion> = HashMap::new();
    let mut queue: Vec<String> = requested.iter().map(|s| s.to_string()).collect();
    let mut visited: HashSet<String> = HashSet::new();

    while let Some(pkg_id) = queue.pop() {
        if visited.contains(&pkg_id) { continue; }
        visited.insert(pkg_id.clone());

        // Unity Registry packages are not in the VPM index — skip silently.
        if is_unity_registry_package(&pkg_id) {
            eprintln!("[VPM resolver] skipping Unity Registry package: {}", pkg_id);
            continue;
        }

        let pkg = index.get(pkg_id.as_str())
            .ok_or_else(|| AppError::NotFound(format!("VPM package not found: {pkg_id}")))?;

        let version = pkg.latest_version()
            .ok_or_else(|| AppError::NotFound(format!("No versions for package: {pkg_id}")))?;

        resolved.insert(pkg_id.clone(), version);

        for dep_id in version.dependencies.keys() {
            if !visited.contains(dep_id) {
                queue.push(dep_id.clone());
            }
        }
    }

    Ok(resolved.into_values().collect())
}