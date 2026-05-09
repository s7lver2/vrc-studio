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
}