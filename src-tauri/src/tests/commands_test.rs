use vrc_studio_lib::commands::ping;

#[test]
fn ping_returns_pong() {
    let result = ping("hello".to_string());
    assert_eq!(result, "pong: hello");
}