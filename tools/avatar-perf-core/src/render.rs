// tools/avatar-perf-core/src/render.rs
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn render_avatar(
    project_path: &str,
    _scene_path: &str,
    avatar_name: &str,
) -> (Option<String>, Option<String>) {
    if let Some(unity_exe) = find_unity_exe(project_path) {
        if let Some(img) = run_unity_headless(&unity_exe, project_path, avatar_name) {
            return (Some(img), None);
        }
    }
    let fbx = find_avatar_fbx(project_path);
    (None, fbx.map(|p| p.to_string_lossy().to_string()))
}

fn find_unity_exe(project_path: &str) -> Option<String> {
    let version_file = Path::new(project_path)
        .join("ProjectSettings")
        .join("ProjectVersion.txt");
    let content = std::fs::read_to_string(&version_file).ok()?;
    let version_line = content.lines()
        .find(|l| l.starts_with("m_EditorVersion:"))?;
    let version = version_line.split(':').nth(1)?.trim();

    #[cfg(target_os = "windows")]
    {
        let hub_dir = Path::new("C:/Program Files/Unity/Hub/Editor");
        if hub_dir.exists() {
            // Try exact version match first
            let exact = hub_dir.join(version).join("Editor").join("Unity.exe");
            if exact.exists() {
                return Some(exact.to_string_lossy().to_string());
            }
            // Fall back to any installed version
            if let Ok(entries) = std::fs::read_dir(hub_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let exe = entry.path().join("Editor").join("Unity.exe");
                    if exe.exists() {
                        return Some(exe.to_string_lossy().to_string());
                    }
                }
            }
        }
        let alt = format!("C:/Program Files/Unity {}/Editor/Unity.exe", version);
        if Path::new(&alt).exists() { return Some(alt); }
    }

    #[cfg(target_os = "macos")]
    {
        let path = format!("/Applications/Unity/Hub/Editor/{}/Unity.app/Contents/MacOS/Unity", version);
        if Path::new(&path).exists() { return Some(path); }
    }

    None
}

fn run_unity_headless(
    unity_exe: &str,
    project_path: &str,
    avatar_name: &str,
) -> Option<String> {
    let editor_dir = Path::new(project_path).join("Assets").join("Editor");
    std::fs::create_dir_all(&editor_dir).ok()?;

    let script_path = editor_dir.join("VRCStudioRender.cs");
    let output_path = std::env::temp_dir().join("vrcstudio_avatar_render.png");
    let output_str = output_path.to_string_lossy().replace('\\', "/");

    let script = format!(r#"using UnityEngine;
using UnityEditor;
using System.IO;
public class VRCStudioRender {{
    [MenuItem("VRCStudio/RenderAvatar")]
    public static void Render() {{
        string avatarName = "{avatar_name}";
        string outputPath = @"{output_str}";
        GameObject avatar = GameObject.Find(avatarName);
        if (avatar == null) {{ Debug.LogError("VRCStudio: Avatar not found: " + avatarName); EditorApplication.Exit(1); return; }}
        var cam = new GameObject("RenderCam").AddComponent<Camera>();
        cam.backgroundColor = new Color(0.08f, 0.08f, 0.08f, 1f);
        cam.clearFlags = CameraClearFlags.SolidColor;
        var renderers = avatar.GetComponentsInChildren<Renderer>();
        var bounds = renderers.Length > 0 ? renderers[0].bounds : new Bounds(avatar.transform.position, Vector3.one * 2f);
        foreach (var r in renderers) bounds.Encapsulate(r.bounds);
        float dist = bounds.size.magnitude * 1.1f;
        cam.transform.position = bounds.center + new Vector3(0, 0, -dist);
        cam.transform.LookAt(bounds.center);
        var animator = avatar.GetComponent<Animator>();
        if (animator != null) animator.enabled = false;
        var rt = new RenderTexture(512, 512, 24);
        cam.targetTexture = rt;
        cam.Render();
        RenderTexture.active = rt;
        var tex = new Texture2D(512, 512, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, 512, 512), 0, 0);
        tex.Apply();
        File.WriteAllBytes(outputPath, tex.EncodeToPNG());
        EditorApplication.Exit(0);
    }}
}}"#,
        avatar_name = avatar_name,
        output_str = output_str,
    );

    std::fs::write(&script_path, &script).ok()?;

    let status = Command::new(unity_exe)
        .args(["-batchmode", "-projectPath", project_path,
               "-executeMethod", "VRCStudioRender.Render", "-quit", "-logFile", "-"])
        .status()
        .ok()?;

    let _ = std::fs::remove_file(&script_path);
    let _ = std::fs::remove_file(script_path.with_extension("cs.meta"));

    if status.success() && output_path.exists() {
        Some(output_path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn find_avatar_fbx(project_path: &str) -> Option<PathBuf> {
    let assets = Path::new(project_path).join("Assets");
    if !assets.exists() { return None; }
    walkdir::WalkDir::new(&assets)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("fbx"))
                .unwrap_or(false)
        })
        .max_by_key(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .map(|e| e.path().to_path_buf())
}
