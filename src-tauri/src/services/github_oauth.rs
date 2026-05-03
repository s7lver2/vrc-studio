use reqwest::Client;
use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID: &str = env!("GITHUB_OAUTH_CLIENT_ID");
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

// ── GitHub API response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    #[allow(dead_code)]
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    #[allow(dead_code)]
    token_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubUser {
    login: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
}

// ── Public types ──────────────────────────────────────────────────────────────

/// Datos que el usuario necesita ver para completar la autenticación.
#[derive(Debug, Serialize, Clone)]
pub struct DevicePrompt {
    pub user_code: String,
    pub verification_uri: String,
    /// Intervalo de polling recomendado por GitHub (segundos).
    pub interval: u64,
}

/// Información del usuario de GitHub autenticado.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GithubUserInfo {
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Paso 1: solicitar device code a GitHub.
/// Devuelve `(device_code_opaco, DevicePrompt)`.
/// El `device_code` se pasa luego a `poll_for_token`; nunca se muestra al usuario.
pub async fn request_device_code() -> Result<(String, DevicePrompt), String> {
    let client = Client::builder()
        .user_agent("vrc-studio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let res: DeviceCodeResponse = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo,user:email")])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse error: {e}"))?;

    let prompt = DevicePrompt {
        user_code: res.user_code,
        verification_uri: res.verification_uri,
        interval: res.interval.max(5),
    };
    Ok((res.device_code, prompt))
}

/// Paso 2: hacer polling hasta que el usuario autorice o expire el device code.
/// Devuelve el access token de GitHub en caso de éxito.
pub async fn poll_for_token(device_code: String, interval_secs: u64) -> Result<String, String> {
    let client = Client::builder()
        .user_agent("vrc-studio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(900);
    let mut current_interval = interval_secs.max(5);

    loop {
        if std::time::Instant::now() > deadline {
            return Err("GitHub auth timed out (15 min)".into());
        }

        tokio::time::sleep(std::time::Duration::from_secs(current_interval)).await;

        let res: TokenResponse = client
            .post(TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", &device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?
            .json()
            .await
            .map_err(|e| format!("parse error: {e}"))?;

        match res.error.as_deref() {
            None => {
                return res
                    .access_token
                    .ok_or_else(|| "no access_token in response".into());
            }
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                current_interval += 5;
                continue;
            }
            Some("expired_token") => return Err("Device code expired — please try again".into()),
            Some("access_denied") => return Err("Authorization denied by user".into()),
            Some(other) => return Err(format!("GitHub error: {other}")),
        }
    }
}

/// Obtiene la información básica del usuario GitHub autenticado con `token`.
pub async fn get_user_info(token: &str) -> Result<GithubUserInfo, String> {
    let client = Client::builder()
        .user_agent("vrc-studio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let user: GithubUser = client
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse error: {e}"))?;

    Ok(GithubUserInfo {
        login: user.login,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
    })
}