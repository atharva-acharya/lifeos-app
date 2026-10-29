//! Read-only Google Sheets access (ADR 0006, threat model T9, T10).
//! OAuth for installed apps with PKCE and a loopback redirect; the refresh
//! token lives in Windows Credential Manager; only Google hosts are called.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SCOPE: &str = "https://www.googleapis.com/auth/spreadsheets.readonly";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SHEETS_URL: &str = "https://sheets.googleapis.com/v4/spreadsheets";
const ALLOWED_HOSTS: &[&str] = &[
    "accounts.google.com",
    "oauth2.googleapis.com",
    "sheets.googleapis.com",
];
const KEYRING_SERVICE: &str = "lifeos-app";
const KEYRING_USER: &str = "google-refresh-token";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
pub const SHEET_TAB: &str = "Applications";

#[derive(Debug, thiserror::Error)]
pub enum GoogleError {
    #[error("Google is not set up yet: add the client ID, secret and Sheet ID in Settings")]
    NotConfigured,
    #[error("not connected to Google; click Connect in Settings")]
    NotConnected,
    #[error("the Sheet ID does not look right; copy it from the Sheet's address bar")]
    BadSheetId,
    #[error("sign-in was cancelled or did not finish in time")]
    LoginAborted,
    #[error("sign-in failed: {0}")]
    Login(String),
    #[error("Google refused the request ({0}); try reconnecting in Settings")]
    Rejected(u16),
    #[error("could not reach Google; showing the last saved copy")]
    Network,
    #[error("refused to contact an unexpected host")]
    HostNotAllowed,
    #[error("Windows Credential Manager error: {0}")]
    Keyring(String),
}

/// Values the owner enters once in Settings; stored in local settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleConfig {
    pub client_id: String,
    pub client_secret: String,
    pub sheet_id: String,
}

impl GoogleConfig {
    pub fn is_complete(&self) -> bool {
        !self.client_id.trim().is_empty()
            && !self.client_secret.trim().is_empty()
            && valid_sheet_id(&self.sheet_id)
    }
}

/// Sheet IDs are base64url-like; anything else could alter the request path.
pub fn valid_sheet_id(id: &str) -> bool {
    (20..=100).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn check_host(url: &Url) -> Result<(), GoogleError> {
    match (url.scheme(), url.host_str()) {
        ("https", Some(host)) if ALLOWED_HOSTS.contains(&host) => Ok(()),
        _ => Err(GoogleError::HostNotAllowed),
    }
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// PKCE S256 challenge for a verifier (RFC 7636).
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> Url {
    let mut url = Url::parse(AUTH_URL).expect("constant URL");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url
}

/// Pulls the authorisation code out of the redirect's request line,
/// checking the state value to stop forged redirects.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Result<String, GoogleError> {
    let target = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| GoogleError::Login("unexpected redirect".into()))?;
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| GoogleError::Login("unexpected redirect".into()))?;
    let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err(GoogleError::Login("state did not match".into()));
    }
    if let Some(err) = params.get("error") {
        return Err(GoogleError::Login(err.clone()));
    }
    params
        .get("code")
        .cloned()
        .ok_or_else(|| GoogleError::Login("no code returned".into()))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("HTTP client")
}

async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<reqwest::Response, GoogleError> {
    let url = Url::parse(url).map_err(|_| GoogleError::HostNotAllowed)?;
    check_host(&url)?;
    let res = http()
        .post(url)
        .form(form)
        .send()
        .await
        .map_err(|_| GoogleError::Network)?;
    if res.status().is_success() {
        Ok(res)
    } else {
        Err(GoogleError::Rejected(res.status().as_u16()))
    }
}

fn entry() -> Result<keyring::Entry, GoogleError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| GoogleError::Keyring(e.to_string()))
}

pub fn is_connected() -> bool {
    entry()
        .and_then(|e| {
            e.get_password()
                .map_err(|e| GoogleError::Keyring(e.to_string()))
        })
        .is_ok()
}

/// Runs the browser sign-in and stores the refresh token.
pub async fn connect(config: &GoogleConfig) -> Result<(), GoogleError> {
    if !config.is_complete() {
        return Err(GoogleError::NotConfigured);
    }
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| GoogleError::Login(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| GoogleError::Login(e.to_string()))?
        .port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random_token(64);
    let state = random_token(32);
    let url = auth_url(
        &config.client_id,
        &redirect,
        &pkce_challenge(&verifier),
        &state,
    );
    check_host(&url)?;
    open::that_detached(url.as_str()).map_err(|e| GoogleError::Login(e.to_string()))?;

    let expected = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(&listener, &expected))
        .await
        .map_err(|_| GoogleError::LoginAborted)??;

    let res = post_form(
        TOKEN_URL,
        &[
            ("client_id", &config.client_id),
            ("client_secret", &config.client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect),
        ],
    )
    .await?;
    let token: TokenResponse = res.json().await.map_err(|_| GoogleError::Network)?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| GoogleError::Login("Google did not return a refresh token".into()))?;
    entry()?
        .set_password(&refresh)
        .map_err(|e| GoogleError::Keyring(e.to_string()))
}

fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, GoogleError> {
    listener
        .set_nonblocking(true)
        .map_err(|e| GoogleError::Login(e.to_string()))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let mut line = String::new();
                BufReader::new(&stream)
                    .read_line(&mut line)
                    .map_err(|e| GoogleError::Login(e.to_string()))?;
                // Ignore stray requests such as /favicon.ico.
                if !line.contains("state=") {
                    let _ =
                        stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let result = parse_redirect(&line, state);
                let body = if result.is_ok() {
                    "Life OS is connected to Google. You can close this tab."
                } else {
                    "Sign-in did not complete. Return to Life OS and try again."
                };
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
                return result;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(GoogleError::LoginAborted);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(GoogleError::Login(e.to_string())),
        }
    }
}

/// Revokes the token with Google (best effort) and removes it locally.
pub async fn disconnect() -> Result<(), GoogleError> {
    let entry = entry()?;
    if let Ok(token) = entry.get_password() {
        let _ = post_form(REVOKE_URL, &[("token", &token)]).await;
    }
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(GoogleError::Keyring(e.to_string())),
    }
}

async fn access_token(config: &GoogleConfig) -> Result<String, GoogleError> {
    let refresh = entry()?
        .get_password()
        .map_err(|_| GoogleError::NotConnected)?;
    let res = post_form(
        TOKEN_URL,
        &[
            ("client_id", &config.client_id),
            ("client_secret", &config.client_secret),
            ("refresh_token", &refresh),
            ("grant_type", "refresh_token"),
        ],
    )
    .await?;
    let token: TokenResponse = res.json().await.map_err(|_| GoogleError::Network)?;
    Ok(token.access_token)
}

#[derive(Deserialize)]
struct ValueRange {
    #[serde(default)]
    values: Vec<Vec<String>>,
}

/// Fetches the Applications tab as rows of cells (first row = headers).
pub async fn fetch_sheet(config: &GoogleConfig) -> Result<Vec<Vec<String>>, GoogleError> {
    if !config.is_complete() {
        return Err(GoogleError::NotConfigured);
    }
    if !valid_sheet_id(&config.sheet_id) {
        return Err(GoogleError::BadSheetId);
    }
    let token = access_token(config).await?;
    let mut url = Url::parse(SHEETS_URL).expect("constant URL");
    url.path_segments_mut()
        .expect("base URL")
        .push(&config.sheet_id)
        .push("values")
        .push(SHEET_TAB);
    url.query_pairs_mut()
        .append_pair("majorDimension", "ROWS")
        .append_pair("valueRenderOption", "FORMATTED_VALUE");
    check_host(&url)?;
    let res = http()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| GoogleError::Network)?;
    if !res.status().is_success() {
        return Err(GoogleError::Rejected(res.status().as_u16()));
    }
    let body: ValueRange = res.json().await.map_err(|_| GoogleError::Network)?;
    Ok(body.values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc_7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_tokens_are_unique_and_url_safe() {
        let a = random_token(64);
        assert_ne!(a, random_token(64));
        assert!(
            a.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        );
        assert!(a.len() >= 43);
    }

    #[test]
    fn auth_url_requests_read_only_scope_with_pkce() {
        let url = auth_url("client", "http://127.0.0.1:5000", "challenge", "state123");
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(q["scope"], SCOPE);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "state123");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5000");
    }

    #[test]
    fn redirect_returns_code_only_with_matching_state() {
        assert_eq!(
            parse_redirect("GET /?state=abc&code=4%2Fxyz HTTP/1.1", "abc").expect("code"),
            "4/xyz"
        );
        assert!(parse_redirect("GET /?state=evil&code=1 HTTP/1.1", "abc").is_err());
        assert!(parse_redirect("GET /?code=1 HTTP/1.1", "abc").is_err());
        assert!(parse_redirect("GET /?state=abc&error=access_denied HTTP/1.1", "abc").is_err());
        assert!(parse_redirect("garbage", "abc").is_err());
    }

    #[test]
    fn only_google_https_hosts_are_allowed() {
        for ok in [TOKEN_URL, REVOKE_URL, AUTH_URL, SHEETS_URL] {
            assert!(check_host(&Url::parse(ok).expect("url")).is_ok(), "{ok}");
        }
        for bad in [
            "http://oauth2.googleapis.com/token",
            "https://evil.example/token",
            "https://oauth2.googleapis.com.evil.example/",
        ] {
            assert!(check_host(&Url::parse(bad).expect("url")).is_err(), "{bad}");
        }
    }

    #[test]
    fn sheet_id_is_validated() {
        assert!(valid_sheet_id("1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab"));
        assert!(!valid_sheet_id("short"));
        assert!(!valid_sheet_id("1AbCdEfGhIjKlMnOpQrStUv/../../x"));
        assert!(!valid_sheet_id("1AbCdEfGhIjKlMnOpQrStUv?alt=media"));
    }

    #[test]
    fn config_needs_all_three_values() {
        let mut c = GoogleConfig {
            client_id: "id".into(),
            client_secret: "secret".into(),
            sheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab".into(),
        };
        assert!(c.is_complete());
        c.client_secret = " ".into();
        assert!(!c.is_complete());
    }
}
