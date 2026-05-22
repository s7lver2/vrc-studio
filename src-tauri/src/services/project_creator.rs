use crate::error::AppError;
use crate::models::VpmPackageVersion;
use std::path::Path;
use tokio::fs;

pub struct ProjectStructureOptions {
    pub unity_version: String,
    pub vcs_enabled: bool,
}

/// Returns the default Packages/manifest.json content for new Unity 2022 projects.
/// Includes built-in modules required by VRChat SDK 4.x and Oculus XR package.
pub fn default_manifest_json() -> String {
    serde_json::json!({
        "dependencies": {
            "com.unity.modules.androidjni": "1.0.0",
            "com.unity.modules.video": "1.0.0"
        }
    })
    .to_string()
}

pub async fn create_project_structure(
    project_dir: &Path,
    opts: &ProjectStructureOptions,
) -> Result<(), AppError> {
    for dir in &["Assets", "Packages", "ProjectSettings", "UserSettings"] {
        fs::create_dir_all(project_dir.join(dir)).await?;
    }

    fs::write(
        project_dir.join("Packages/manifest.json"),
        default_manifest_json(),
    ).await?;
    fs::write(project_dir.join("Packages/vpm-manifest.json"), "{\n  \"dependencies\": {},\n  \"locked\": {}\n}\n").await?;

    let version_content = format!(
        "m_EditorVersion: {}\nm_EditorVersionWithRevision: {}\n",
        opts.unity_version, opts.unity_version
    );
    fs::write(project_dir.join("ProjectSettings/ProjectVersion.txt"), version_content).await?;
    fs::write(
        project_dir.join("ProjectSettings/EditorBuildSettings.asset"),
        "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1045 &1\nEditorBuildSettings:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Scenes: []\n",
    ).await?;

    if opts.vcs_enabled {
        let pd = project_dir.to_path_buf();
        tokio::task::spawn_blocking(move || {
            crate::services::git_service::init_repository(&pd)
        })
        .await
        .map_err(|e| crate::error::AppError::Io(e.to_string()))?
        .map_err(|e| crate::error::AppError::Io(e))?;
    }

    Ok(())
}

pub async fn install_vpm_package(
    project_dir: &Path,
    pkg: &VpmPackageVersion,
    mut progress_cb: impl FnMut(f32),
) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    let response = client.get(&pkg.url).send().await
        .map_err(|e| AppError::External(format!("Download failed for {}: {e}", pkg.name)))?;

    let bytes = response.bytes().await
        .map_err(|e| AppError::External(e.to_string()))?;

    progress_cb(1.0);

    let pkg_dir = project_dir.join("Packages").join(&pkg.name);
    fs::create_dir_all(&pkg_dir).await?;

    let cursor = std::io::Cursor::new(&bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::External(format!("Zip open error: {e}")))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| AppError::External(e.to_string()))?;
        let out_path = pkg_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut file, &mut out_file)?;
        }
    }

    Ok(())
}

const UNITY_GITIGNORE: &str = r#"# Unity generated
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Mm]emoryCaptures/
[Uu]serSettings/

*.pidb.meta
*.pdb.meta
*.mdb.meta

# VisualStudio
*.pidb
*.unityproj
*.sln
*.suo
*.tmp
*.user
*.userprefs
*.csproj
.vs/

# JetBrains
.idea/
*.iml
ExportedObj/
.consulo/

# OS generated
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Crash reports
sysinfo.txt

# VRC Studio
.vrc-studio/
"#;