#[cfg(test)]
mod tests {
    use vrc_studio_lib::error::AppError;

    #[test]
    fn app_error_converts_to_string() {
        let e = AppError::Database("connection failed".to_string());
        assert_eq!(e.to_string(), "Database error: connection failed");
    }

    #[test]
    fn app_error_not_found_message() {
        let e = AppError::NotFound("project 42".to_string());
        assert_eq!(e.to_string(), "Not found: project 42");
    }
}