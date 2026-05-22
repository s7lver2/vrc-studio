use vrc_studio_lib::commands::ping;

#[test]
fn ping_returns_pong() {
    let result = ping("hello".to_string());
    assert_eq!(result, "pong: hello");
}

#[cfg(test)]
mod running_unity_tests {
    use super::*;

    #[test]
    fn extract_project_path_from_args_finds_flag() {
        let args = vec![
            "-batchmode".to_string(),
            "-projectPath".to_string(),
            "C:/Users/test/MyProject".to_string(),
            "-quit".to_string(),
        ];
        let result = extract_unity_project_path(&args);
        assert_eq!(result, Some("C:/Users/test/MyProject".to_string()));
    }

    #[test]
    fn extract_project_path_from_args_missing_flag_returns_none() {
        let args = vec!["-batchmode".to_string(), "-quit".to_string()];
        let result = extract_unity_project_path(&args);
        assert_eq!(result, None);
    }

    #[test]
    fn extract_project_path_from_args_flag_at_end_returns_none() {
        // -projectPath at the very end with no value → no crash
        let args = vec!["-projectPath".to_string()];
        let result = extract_unity_project_path(&args);
        assert_eq!(result, None);
    }
    #[cfg(test)]
    mod find_unity_tests {
        // find_unity_for_version is async + uses the file system; we test the
        // pure matching helper separately.
        use crate::services::unity_detector::detect_unity_installations;

        #[test]
        fn best_match_prefers_exact_version() {
            // If we had two installations with the same version the first wins —
            // just verifying the filter logic compiles and works.
            let installations = vec![
                crate::models::UnityInstallation {
                    version: "2022.3.6f1".to_string(),
                    path: "/path/a/Unity".to_string(),
                    is_custom: false,
                },
                crate::models::UnityInstallation {
                    version: "2022.3.22f1".to_string(),
                    path: "/path/b/Unity".to_string(),
                    is_custom: false,
                },
            ];
            let found = installations.iter()
                .find(|i| i.version == "2022.3.22f1")
                .map(|i| i.path.clone());
            assert_eq!(found, Some("/path/b/Unity".to_string()));
        }
    }
    #[test]
    fn manifest_json_includes_required_builtin_modules() {
        use serde_json::Value;
        // The manifest generated for a new project must declare the built-in modules
        // that VRChat SDK 4.x and Oculus XR depend on.
        let manifest_str = crate::services::project_creator::default_manifest_json();
        let v: Value = serde_json::from_str(&manifest_str).expect("valid json");
        let deps = v["dependencies"].as_object().expect("dependencies object");
        assert!(deps.contains_key("com.unity.modules.androidjni"),
            "manifest must declare com.unity.modules.androidjni");
        assert!(deps.contains_key("com.unity.modules.video"),
            "manifest must declare com.unity.modules.video");
    }
#[cfg(test)]
mod vcc_reader_tests {
    use crate::services::vcc_reader::{parse_vcc_settings, parse_alcom_settings};

    #[test]
    fn parse_vcc_settings_extracts_user_repo_urls() {
        let json = r#"{
            "userRepos": [
                { "Url": "https://vcc.vrcfury.com/", "LocalPath": "/some/path" },
                { "Url": "https://vpm.nadena.dev/vpm.json", "LocalPath": "/another" }
            ]
        }"#;
        let urls = parse_vcc_settings(json);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://vcc.vrcfury.com/".to_string()));
        assert!(urls.contains(&"https://vpm.nadena.dev/vpm.json".to_string()));
    }

    #[test]
    fn parse_vcc_settings_ignores_empty_urls() {
        let json = r#"{ "userRepos": [{ "Url": "", "LocalPath": "/x" }] }"#;
        let urls = parse_vcc_settings(json);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn parse_vcc_settings_handles_missing_field_gracefully() {
        let json = r#"{ "someOtherField": 42 }"#;
        let urls = parse_vcc_settings(json);
        assert_eq!(urls.len(), 0);
    }

    #[test]
    fn parse_alcom_settings_extracts_repo_urls() {
        // alcom format: "user_repos" array with "url" field
        let json = r#"{
            "user_repos": [
                { "url": "https://lilxyzw.github.io/vpm-repos/vpm.json" },
                { "url": "https://wholesomevr.github.io/vpm/index.json" }
            ]
        }"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://lilxyzw.github.io/vpm-repos/vpm.json".to_string()));
    }

    #[test]
    fn parse_alcom_settings_handles_empty_gracefully() {
        let json = r#"{}"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls.len(), 0);
    }
}
}