use keyring::Entry;

const SERVICE_NAME: &str = "vrc-studio";

fn entry(provider: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE_NAME, provider)
}

pub fn store_token(provider: &str, token: &str) -> Result<(), String> {
    entry(provider)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

pub fn get_token(provider: &str) -> Result<Option<String>, String> {
    match entry(provider).map_err(|e| e.to_string())?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_token(provider: &str) -> Result<(), String> {
    match entry(provider).map_err(|e| e.to_string())?.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve_token() {
        let provider = "booth_test_vrcstudio";
        store_token(provider, "mytoken123").unwrap();
        let retrieved = get_token(provider).unwrap();
        assert_eq!(retrieved, Some("mytoken123".to_string()));
        delete_token(provider).unwrap();
    }

    #[test]
    fn test_get_missing_token_returns_none() {
        let result = get_token("nonexistent_provider_xyz_vrcstudio").unwrap();
        assert_eq!(result, None);
    }
}