use reqwest::Client;
use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID: &str = env!("GITHUB_OAUTH_CLIENT_ID");
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

// ── GitHub API response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct DeviceCodeOk {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    #[allow(dead_code)]
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GithubApiError {
    error: String,
    #[allow(dead_code)]
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum DeviceCodeResponse {
    Ok(DeviceCodeOk),
    Err(GithubApiError),
}

#[derive(Debug, Deserialize)]
struct TokenOk {
    access_token: Option<String>,
    error: Option<String>,
    #[allow(dead_code)]
    token_type: Option<String>,
}

type TokenResponse = TokenOk;

#[derive(Debug, Deserialize)]
struct GithubUser {
    login: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
}

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct DevicePrompt {
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GithubUserInfo {
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

// ── Public API ────────────────────────────────────────────────────────────────

pub async fn request_device_code() -> Result<(String, DevicePrompt), String> {
    let client = Client::builder()
        .user_agent("vrc-studio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let raw = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo,user:email")])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read error: {e}"))?;

    let parsed: DeviceCodeResponse = serde_json::from_str(&raw)
        .map_err(|e| format!("parse error (body: {raw:?}): {e}"))?;

    let ok = match parsed {
        DeviceCodeResponse::Ok(o) => o,
        DeviceCodeResponse::Err(err) => {
            return Err(format!(
                "GitHub error: {} — check your GITHUB_OAUTH_CLIENT_ID",
                err.error
            ));
        }
    };

    let prompt = DevicePrompt {
        user_code: ok.user_code,
        verification_uri: ok.verification_uri,
        interval: ok.interval.max(5),
    };
    Ok((ok.device_code, prompt))
}

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
            .header("Accept", "application/json")   // ← AÑADIR ESTA LÍNEA
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