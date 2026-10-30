//! Read-only Google Sheets access (ADR 0006, threat model T9, T10).
//! OAuth for installed apps with PKCE and a loopback redirect; the refresh
//! token lives in Windows Credential Manager; only Google hosts are called.

use std::collections::HashMap;
use std::io::{Read, Write};
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
/// Per-connection limits for the loopback listener (threat model T9).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_LINE: u64 = 8 * 1024;
/// Caps on what Google may send back (threat model T6/T9).
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ROWS: usize = 20_000;
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
    #[error("the Sheet is too large to load (over 10 MB or 20,000 rows)")]
    TooLarge,
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

/// Desktop OAuth client IDs look like `123-abc.apps.googleusercontent.com`.
pub fn valid_client_id(id: &str) -> bool {
    id.len() <= 200
        && id
            .strip_suffix(".apps.googleusercontent.com")
            .and_then(|head| head.split_once('-'))
            .is_some_and(|(num, rest)| {
                !num.is_empty()
                    && num.bytes().all(|b| b.is_ascii_digit())
                    && !rest.is_empty()
                    && rest
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })
}

/// Client secrets are short printable ASCII.
pub fn valid_client_secret(secret: &str) -> bool {
    (1..=100).contains(&secret.len()) && secret.bytes().all(|b| b.is_ascii_graphic())
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

/// Reads a JSON body, refusing anything over `MAX_RESPONSE_BYTES`.
async fn read_json<T: serde::de::DeserializeOwned>(
    mut res: reqwest::Response,
) -> Result<T, GoogleError> {
    let cap = MAX_RESPONSE_BYTES;
    if res.content_length().is_some_and(|n| n > cap as u64) {
        return Err(GoogleError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| GoogleError::Network)? {
        if body.len() + chunk.len() > cap {
            return Err(GoogleError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| GoogleError::Network)
}

/// Asks Google to revoke a token. A 400 means it is already invalid.
async fn revoke(token: &str) -> bool {
    matches!(
        post_form(REVOKE_URL, &[("token", token)]).await,
        Ok(_) | Err(GoogleError::Rejected(400))
    )
}

/// Credential Manager account name. Debug runs with a test data folder use
/// their own entry, so end-to-end tests never read the owner's real token.
fn keyring_user() -> &'static str {
    if crate::commands::test_data_dir().is_some() {
        "e2e-refresh-token"
    } else {
        KEYRING_USER
    }
}

fn entry() -> Result<keyring::Entry, GoogleError> {
    keyring::Entry::new(KEYRING_SERVICE, keyring_user())
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
    // Reconnecting: end the old grant first. Revoking afterwards would also
    // cancel the new token, because Google revokes the whole grant.
    disconnect().await?;
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
    let token: TokenResponse = read_json(res).await?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| GoogleError::Login("Google did not return a refresh token".into()))?;
    entry()?
        .set_password(&refresh)
        .map_err(|e| GoogleError::Keyring(e.to_string()))
}

/// What one request to the loopback listener means for the sign-in.
#[derive(Debug)]
pub enum Redirect {
    /// Not our redirect (favicon, probes, a forged state): answer and keep waiting.
    Ignore,
    /// Google's redirect with our state: the sign-in ends here.
    Done(Result<String, GoogleError>),
}

/// Only a `GET /?...` carrying the expected state can end the sign-in, so a
/// local process or web page that finds the port cannot cancel it.
pub fn classify(request_line: &str, expected_state: &str) -> Redirect {
    if !request_line.starts_with("GET /?") {
        return Redirect::Ignore;
    }
    let state_ok = request_line
        .split_whitespace()
        .nth(1)
        .and_then(|t| Url::parse(&format!("http://127.0.0.1{t}")).ok())
        .is_some_and(|u| {
            u.query_pairs()
                .any(|(k, v)| k == "state" && v == expected_state)
        });
    if state_ok {
        Redirect::Done(parse_redirect(request_line, expected_state))
    } else {
        Redirect::Ignore
    }
}

fn reply(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

/// Reads the request line with a deadline for the whole line, so a client
/// that trickles bytes cannot hold the listener.
fn read_request_line(stream: &std::net::TcpStream) -> Option<String> {
    let until = Instant::now() + REQUEST_TIMEOUT;
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    let mut reader = stream.take(MAX_REQUEST_LINE);
    loop {
        let left = until.checked_duration_since(Instant::now())?;
        stream
            .set_read_timeout(Some(left.max(Duration::from_millis(1))))
            .ok()?;
        match reader.read(&mut byte) {
            Ok(1) if byte[0] == b'\n' => break,
            Ok(1) => line.push(byte[0]),
            // Closed early or over the size cap.
            Ok(_) => return None,
            Err(_) => return None,
        }
    }
    String::from_utf8(line).ok()
}

fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, GoogleError> {
    listener
        .set_nonblocking(true)
        .map_err(|e| GoogleError::Login(e.to_string()))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err(GoogleError::LoginAborted);
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                // A silent, slow or endless connection must not stall the sign-in.
                if stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let Some(line) = read_request_line(&stream) else {
                    continue;
                };
                match classify(&line, state) {
                    Redirect::Ignore => reply(&mut stream, "404 Not Found", ""),
                    Redirect::Done(result) => {
                        let body = if result.is_ok() {
                            "Life OS is connected to Google. You can close this tab."
                        } else {
                            "Sign-in did not complete. Return to Life OS and try again."
                        };
                        reply(&mut stream, "200 OK", body);
                        return result;
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(GoogleError::Login(e.to_string())),
        }
    }
}

/// Removes the token locally and asks Google to revoke it. Returns `false`
/// when Google could not be told, so the owner can revoke it by hand.
pub async fn disconnect() -> Result<bool, GoogleError> {
    let entry = entry()?;
    let revoked = match entry.get_password() {
        Ok(token) => revoke(&token).await,
        Err(_) => true,
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(revoked),
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
    let token: TokenResponse = read_json(res).await?;
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
    let body: ValueRange = read_json(res).await?;
    if body.values.len() > MAX_ROWS {
        return Err(GoogleError::TooLarge);
    }
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

    #[test]
    fn only_our_redirect_ends_the_sign_in() {
        let done = |line: &str| matches!(classify(line, "abc"), Redirect::Done(_));
        assert!(done("GET /?state=abc&code=1 HTTP/1.1"));
        assert!(done("GET /?state=abc&error=access_denied HTTP/1.1"));
        // Probes, favicons and forged states are answered and ignored.
        assert!(!done("GET /favicon.ico HTTP/1.1"));
        assert!(!done("GET /?state=evil&code=1 HTTP/1.1"));
        assert!(!done("GET /?code=1 HTTP/1.1"));
        assert!(!done("POST /?state=abc&code=1 HTTP/1.1"));
        assert!(!done("\u{0}\u{1}garbage"));
        assert!(!done(""));
    }

    #[test]
    fn listener_ignores_a_silent_connection_and_still_signs_in() {
        use std::net::TcpStream;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let waiter = std::thread::spawn(move || wait_for_code(&listener, "abc"));
        // Opens and says nothing: must time out without blocking the sign-in.
        let _silent = TcpStream::connect(addr).expect("silent");
        // A forged redirect must not cancel it either.
        let mut forged = TcpStream::connect(addr).expect("forged");
        forged
            .write_all(b"GET /?state=evil&code=x HTTP/1.1\r\n\r\n")
            .expect("write");
        let mut real = TcpStream::connect(addr).expect("real");
        real.write_all(b"GET /?state=abc&code=good HTTP/1.1\r\n\r\n")
            .expect("write");
        assert_eq!(waiter.join().expect("join").expect("code"), "good");
    }

    #[test]
    fn client_id_and_secret_are_validated() {
        assert!(valid_client_id(
            "123456789012-abcdef0123456789.apps.googleusercontent.com"
        ));
        assert!(!valid_client_id("123.apps.googleusercontent.com"));
        assert!(!valid_client_id("abc-def.apps.googleusercontent.com"));
        assert!(!valid_client_id(
            "123-abc.apps.googleusercontent.com.evil.com"
        ));
        assert!(!valid_client_id("123-ABC.apps.googleusercontent.com"));
        assert!(valid_client_secret("GOCSPX-example_Secret-123"));
        assert!(!valid_client_secret(""));
        assert!(!valid_client_secret("has space"));
        assert!(!valid_client_secret("line\nbreak"));
        assert!(!valid_client_secret(&"x".repeat(101)));
    }

    #[test]
    fn a_trickling_client_is_dropped_after_the_request_limit() {
        use std::net::TcpStream;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let writer = std::thread::spawn(move || {
            let mut slow = TcpStream::connect(addr).expect("connect");
            for _ in 0..20 {
                if slow.write_all(b"G").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
        let (stream, _) = listener.accept().expect("accept");
        let started = Instant::now();
        assert_eq!(read_request_line(&stream), None);
        let took = started.elapsed();
        assert!(took >= REQUEST_TIMEOUT && took < REQUEST_TIMEOUT + Duration::from_secs(2));
        drop(stream);
        writer.join().expect("join");
    }
}
