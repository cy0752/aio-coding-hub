use sha2::{Digest, Sha256};

pub(super) struct ClaudeMetadataUserIdInjectionSkip {
    pub(super) reason: &'static str,
    pub(super) error: Option<String>,
}

pub(super) enum ClaudeMetadataUserIdInjectionOutcome {
    Injected { body_bytes: Vec<u8> },
    Skipped(ClaudeMetadataUserIdInjectionSkip),
}

pub(super) fn inject_from_json_bytes_with_ua(
    provider_id: i64,
    session_id: Option<&str>,
    body_bytes: &[u8],
    user_agent: Option<&str>,
) -> ClaudeMetadataUserIdInjectionOutcome {
    let Some(session_id) = session_id.map(str::trim).filter(|v| !v.is_empty()) else {
        return ClaudeMetadataUserIdInjectionOutcome::Skipped(ClaudeMetadataUserIdInjectionSkip {
            reason: "missing_session_id",
            error: None,
        });
    };

    let mut root = match serde_json::from_slice::<serde_json::Value>(body_bytes) {
        Ok(root) => root,
        Err(err) => {
            return ClaudeMetadataUserIdInjectionOutcome::Skipped(
                ClaudeMetadataUserIdInjectionSkip {
                    reason: "missing_body_json",
                    error: Some(err.to_string()),
                },
            );
        }
    };

    let Some(root_obj) = root.as_object_mut() else {
        return ClaudeMetadataUserIdInjectionOutcome::Skipped(ClaudeMetadataUserIdInjectionSkip {
            reason: "body_json_not_object",
            error: None,
        });
    };

    let user_id_exists = root_obj
        .get("metadata")
        .and_then(|v| v.as_object())
        .and_then(|v| v.get("user_id"))
        .is_some_and(|v| !v.is_null());
    if user_id_exists {
        return ClaudeMetadataUserIdInjectionOutcome::Skipped(ClaudeMetadataUserIdInjectionSkip {
            reason: "already_exists",
            error: None,
        });
    }

    let stable_hash = stable_hash_for_key(provider_id);
    let use_json_format = should_use_json_format(user_agent);
    let user_id = if use_json_format {
        format_user_id_json(&stable_hash, session_id)
    } else {
        format_user_id_legacy(&stable_hash, session_id)
    };

    let metadata = root_obj
        .entry("metadata")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !metadata.is_object() {
        *metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    let meta_obj = metadata
        .as_object_mut()
        .expect("metadata must be an object");
    meta_obj.insert(
        "user_id".to_string(),
        serde_json::Value::String(user_id.clone()),
    );

    match serde_json::to_vec(&root) {
        Ok(body_bytes) => ClaudeMetadataUserIdInjectionOutcome::Injected { body_bytes },
        Err(err) => {
            ClaudeMetadataUserIdInjectionOutcome::Skipped(ClaudeMetadataUserIdInjectionSkip {
                reason: "serialize_failed",
                error: Some(err.to_string()),
            })
        }
    }
}

fn format_user_id_legacy(stable_hash: &str, session_id: &str) -> String {
    format!("user_{stable_hash}_account__session_{session_id}")
}

fn format_user_id_json(stable_hash: &str, session_id: &str) -> String {
    // JSON format used by Claude Code CLI v2.1.36+: embed structured data as a JSON string.
    let obj = serde_json::json!({
        "user_id": format!("user_{stable_hash}"),
        "account_id": "account",
        "session_id": session_id,
    });
    obj.to_string()
}

fn stable_hash_for_key(provider_id: i64) -> String {
    let seed = format!("claude_user_{provider_id}");
    let digest = Sha256::digest(seed.as_bytes());
    format!("{digest:x}")
}

/// Detect whether the CLI version supports JSON-format user_id.
/// Claude Code CLI v2.1.36+ uses JSON format; older versions use legacy string concatenation.
fn should_use_json_format(user_agent: Option<&str>) -> bool {
    let Some(ua) = user_agent else {
        return false;
    };
    parse_claude_code_version(ua)
        .map(|(major, minor, patch)| (major, minor, patch) >= (2, 1, 36))
        .unwrap_or(false)
}

/// Extract (major, minor, patch) from a User-Agent containing "claude-code/X.Y.Z".
fn parse_claude_code_version(ua: &str) -> Option<(u32, u32, u32)> {
    let lower = ua.to_lowercase();
    let prefix = "claude-code/";
    let start = lower.find(prefix)? + prefix.len();
    let rest = &ua[start..];
    // Take until next space or end.
    let version_str = rest.split_whitespace().next()?;
    let parts: Vec<&str> = version_str.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = parts[2].parse().ok()?;
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::{
        inject_from_json_bytes_with_ua, parse_claude_code_version, should_use_json_format,
        ClaudeMetadataUserIdInjectionOutcome,
    };
    use sha2::{Digest, Sha256};

    fn expected_hash(provider_id: i64) -> String {
        let seed = format!("claude_user_{provider_id}");
        let digest = Sha256::digest(seed.as_bytes());
        format!("{digest:x}")
    }

    #[test]
    fn injects_user_id_when_missing() {
        let body = serde_json::json!({
            "model": "claude-3-5-sonnet",
            "messages": [],
        });
        let provider_id = 123;
        let session_id = "sess-1";
        let encoded = serde_json::to_vec(&body).expect("serialize");

        let outcome =
            inject_from_json_bytes_with_ua(provider_id, Some(session_id), encoded.as_slice(), None);

        let ClaudeMetadataUserIdInjectionOutcome::Injected { body_bytes } = outcome else {
            panic!("expected injected outcome");
        };

        let next: serde_json::Value =
            serde_json::from_slice(&body_bytes).expect("injected body should be json");
        let user_id = next
            .get("metadata")
            .and_then(|v| v.get("user_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let stable_hash = expected_hash(provider_id);
        assert_eq!(
            user_id,
            format!("user_{stable_hash}_account__session_{session_id}")
        );
    }

    #[test]
    fn injects_json_format_for_new_cli_version() {
        let body = serde_json::json!({
            "model": "claude-3-5-sonnet",
            "messages": [],
        });
        let provider_id = 123;
        let session_id = "sess-1";
        let encoded = serde_json::to_vec(&body).expect("serialize");

        let outcome = inject_from_json_bytes_with_ua(
            provider_id,
            Some(session_id),
            encoded.as_slice(),
            Some("claude-code/2.1.36"),
        );

        let ClaudeMetadataUserIdInjectionOutcome::Injected { body_bytes } = outcome else {
            panic!("expected injected outcome");
        };

        let next: serde_json::Value =
            serde_json::from_slice(&body_bytes).expect("injected body should be json");
        let user_id_str = next
            .get("metadata")
            .and_then(|v| v.get("user_id"))
            .and_then(|v| v.as_str())
            .expect("user_id should be a string");

        // JSON format: the user_id value is itself a JSON string.
        let parsed: serde_json::Value =
            serde_json::from_str(user_id_str).expect("user_id should be valid JSON");
        assert!(parsed.get("user_id").is_some());
        assert!(parsed.get("session_id").is_some());
        assert_eq!(
            parsed.get("session_id").and_then(|v| v.as_str()),
            Some(session_id)
        );
    }

    #[test]
    fn injects_legacy_format_for_old_cli_version() {
        let body = serde_json::json!({
            "model": "claude-3-5-sonnet",
            "messages": [],
        });
        let provider_id = 123;
        let session_id = "sess-1";
        let encoded = serde_json::to_vec(&body).expect("serialize");

        let outcome = inject_from_json_bytes_with_ua(
            provider_id,
            Some(session_id),
            encoded.as_slice(),
            Some("claude-code/2.1.35"),
        );

        let ClaudeMetadataUserIdInjectionOutcome::Injected { body_bytes } = outcome else {
            panic!("expected injected outcome");
        };

        let next: serde_json::Value =
            serde_json::from_slice(&body_bytes).expect("injected body should be json");
        let user_id = next
            .get("metadata")
            .and_then(|v| v.get("user_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let stable_hash = expected_hash(provider_id);
        assert_eq!(
            user_id,
            format!("user_{stable_hash}_account__session_{session_id}")
        );
    }

    #[test]
    fn skips_when_user_id_already_exists() {
        let body = serde_json::json!({
            "model": "claude-3-5-sonnet",
            "messages": [],
            "metadata": {
                "user_id": "existing"
            }
        });
        let encoded = serde_json::to_vec(&body).expect("serialize");

        let outcome = inject_from_json_bytes_with_ua(1, Some("sess-1"), encoded.as_slice(), None);

        let ClaudeMetadataUserIdInjectionOutcome::Skipped(skip) = outcome else {
            panic!("expected skipped outcome");
        };
        assert_eq!(skip.reason, "already_exists");
    }

    #[test]
    fn skips_when_session_id_missing() {
        let body = serde_json::json!({
            "messages": [],
        });
        let encoded = serde_json::to_vec(&body).expect("serialize");

        let outcome = inject_from_json_bytes_with_ua(1, None, encoded.as_slice(), None);
        let ClaudeMetadataUserIdInjectionOutcome::Skipped(skip) = outcome else {
            panic!("expected skipped outcome");
        };
        assert_eq!(skip.reason, "missing_session_id");
    }

    #[test]
    fn skips_when_body_is_not_json() {
        let outcome = inject_from_json_bytes_with_ua(1, Some("sess-1"), b"not-json", None);
        let ClaudeMetadataUserIdInjectionOutcome::Skipped(skip) = outcome else {
            panic!("expected skipped outcome");
        };
        assert_eq!(skip.reason, "missing_body_json");
        assert!(skip.error.is_some());
    }

    #[test]
    fn parse_claude_code_version_extracts_version() {
        assert_eq!(
            parse_claude_code_version("claude-code/2.1.36 node/20.0.0"),
            Some((2, 1, 36))
        );
        assert_eq!(
            parse_claude_code_version("claude-code/2.1.35"),
            Some((2, 1, 35))
        );
        assert_eq!(
            parse_claude_code_version("Mozilla/5.0 claude-code/3.0.0"),
            Some((3, 0, 0))
        );
    }

    #[test]
    fn parse_claude_code_version_returns_none_for_non_claude_ua() {
        assert_eq!(parse_claude_code_version("codex-cli/1.0.0"), None);
        assert_eq!(parse_claude_code_version(""), None);
    }

    #[test]
    fn should_use_json_format_for_new_versions() {
        assert!(should_use_json_format(Some("claude-code/2.1.36")));
        assert!(should_use_json_format(Some("claude-code/2.2.0")));
        assert!(should_use_json_format(Some("claude-code/3.0.0")));
    }

    #[test]
    fn should_use_legacy_format_for_old_versions() {
        assert!(!should_use_json_format(Some("claude-code/2.1.35")));
        assert!(!should_use_json_format(Some("claude-code/2.0.0")));
        assert!(!should_use_json_format(Some("claude-code/1.0.0")));
        assert!(!should_use_json_format(None));
    }
}
