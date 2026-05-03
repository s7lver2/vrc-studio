use vrc_studio_lib::db;
use vrc_studio_lib::models::{Project, UnityType};

#[tokio::test]
async fn migrations_run_successfully() {
    let pool = db::create_test_pool().await.expect("pool creation failed");
    let row = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .fetch_optional(&pool)
        .await
        .expect("query failed");
    assert!(row.is_some(), "projects table should exist after migration");
}

#[tokio::test]
async fn migrations_are_idempotent() {
    let pool = db::create_test_pool().await.expect("pool creation failed");
    let result = db::run_migrations(&pool).await;
    assert!(result.is_ok(), "second migration run should be idempotent");
}

#[test]
fn project_unity_type_serializes() {
    let p = Project {
        id: "test-id".to_string(),
        name: "My Avatar".to_string(),
        path: "/projects/my-avatar".to_string(),
        unity_version: "2022.3.22f1".to_string(),
        unity_type: UnityType::Standard,
        avatar_base_id: None,
        shader: None,
        vcs_enabled: false,
    };
    let json = serde_json::to_string(&p).expect("serialize failed");
    assert!(json.contains("\"unity_type\":\"standard\""));
    assert!(json.contains("\"vcs_enabled\":false"));
}