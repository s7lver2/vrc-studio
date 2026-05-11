#[cfg(test)]
mod tests {
    use vrc_studio_lib::commands::updates::{UpdateManifest, PlatformAsset, compare_versions};

    #[test]
    fn compare_versions_newer_wins() {
        assert!(compare_versions("0.2.0", "0.1.0"));
        assert!(!compare_versions("0.1.0", "0.2.0"));
        assert!(!compare_versions("0.1.0", "0.1.0"));
    }

    #[test]
    fn platform_asset_deserialization() {
        let json = r#"{
            "url": "https://example.com/app.exe",
            "signature": "abc123",
            "size": 12345678
        }"#;
        let asset: PlatformAsset = serde_json::from_str(json).unwrap();
        assert_eq!(asset.url, "https://example.com/app.exe");
        assert_eq!(asset.size, 12345678);
    }
    #[test]
    fn available_version_channel_detection() {
        assert_eq!(
            vrc_studio_lib::commands::updates::channel_from_tag("v0.2.0", false),
            "stable"
        );
        assert_eq!(
            vrc_studio_lib::commands::updates::channel_from_tag("v0.2.0-testing", true),
            "testing"
        );
    }

    #[test]
    fn platform_asset_name_matching() {
        use vrc_studio_lib::commands::updates::asset_matches_platform;
        assert!(asset_matches_platform("VRC-Studio-Setup-0.2.0-windows-amd64.exe", "windows-amd64"));
        assert!(asset_matches_platform("vrc-studio-0.2.0-linux-amd64.tar.gz", "linux-amd64"));
        assert!(!asset_matches_platform("vrc-studio-0.2.0-linux-arm64.tar.gz", "windows-amd64"));
    }
}