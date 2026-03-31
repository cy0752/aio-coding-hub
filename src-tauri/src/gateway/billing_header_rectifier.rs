use regex::Regex;
use std::sync::LazyLock;

static BILLING_HEADER_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*x-anthropic-billing-header\s*:").unwrap());

#[derive(Debug, Clone, Copy)]
pub(super) struct BillingHeaderRectifierResult {
    pub(super) applied: bool,
    pub(super) removed_count: usize,
}

/// Remove `x-anthropic-billing-header` text blocks from the request body's `system` field.
///
/// Claude Code CLI v2.1.36+ injects these blocks into the system prompt. Non-Anthropic
/// upstreams (e.g. Amazon Bedrock) reject them with 400.
pub(super) fn rectify(body: &mut serde_json::Value) -> BillingHeaderRectifierResult {
    let Some(obj) = body.as_object_mut() else {
        return BillingHeaderRectifierResult {
            applied: false,
            removed_count: 0,
        };
    };

    let Some(system) = obj.get_mut("system") else {
        return BillingHeaderRectifierResult {
            applied: false,
            removed_count: 0,
        };
    };

    // Case 1: system is a plain string
    if let Some(text) = system.as_str() {
        if BILLING_HEADER_PATTERN.is_match(text) {
            obj.remove("system");
            return BillingHeaderRectifierResult {
                applied: true,
                removed_count: 1,
            };
        }
        return BillingHeaderRectifierResult {
            applied: false,
            removed_count: 0,
        };
    }

    // Case 2: system is an array of content blocks
    if let Some(arr) = system.as_array_mut() {
        let original_len = arr.len();
        arr.retain(|block| {
            let Some(block_obj) = block.as_object() else {
                return true;
            };
            let is_text_block = block_obj.get("type").and_then(|v| v.as_str()) == Some("text");
            if !is_text_block {
                return true;
            }
            let Some(text) = block_obj.get("text").and_then(|v| v.as_str()) else {
                return true;
            };
            !BILLING_HEADER_PATTERN.is_match(text)
        });

        let removed_count = original_len - arr.len();
        return BillingHeaderRectifierResult {
            applied: removed_count > 0,
            removed_count,
        };
    }

    BillingHeaderRectifierResult {
        applied: false,
        removed_count: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn system_string_matching_is_removed() {
        let mut body = json!({
            "model": "claude-3-5-sonnet",
            "system": "x-anthropic-billing-header: abc123",
            "messages": []
        });

        let result = rectify(&mut body);

        assert!(result.applied);
        assert_eq!(result.removed_count, 1);
        assert!(body.get("system").is_none());
    }

    #[test]
    fn system_string_not_matching_is_kept() {
        let mut body = json!({
            "model": "claude-3-5-sonnet",
            "system": "You are a helpful assistant.",
            "messages": []
        });

        let result = rectify(&mut body);

        assert!(!result.applied);
        assert_eq!(result.removed_count, 0);
        assert!(body.get("system").is_some());
    }

    #[test]
    fn system_array_filters_matching_blocks() {
        let mut body = json!({
            "model": "claude-3-5-sonnet",
            "system": [
                {"type": "text", "text": "You are a helpful assistant."},
                {"type": "text", "text": "x-anthropic-billing-header: abc123"},
                {"type": "text", "text": "Be concise."}
            ],
            "messages": []
        });

        let result = rectify(&mut body);

        assert!(result.applied);
        assert_eq!(result.removed_count, 1);
        let system = body.get("system").unwrap().as_array().unwrap();
        assert_eq!(system.len(), 2);
        assert_eq!(
            system[0].get("text").unwrap().as_str().unwrap(),
            "You are a helpful assistant."
        );
        assert_eq!(
            system[1].get("text").unwrap().as_str().unwrap(),
            "Be concise."
        );
    }

    #[test]
    fn system_array_no_match_is_unchanged() {
        let mut body = json!({
            "model": "claude-3-5-sonnet",
            "system": [
                {"type": "text", "text": "You are a helpful assistant."},
                {"type": "text", "text": "Be concise."}
            ],
            "messages": []
        });

        let result = rectify(&mut body);

        assert!(!result.applied);
        assert_eq!(result.removed_count, 0);
        assert_eq!(body.get("system").unwrap().as_array().unwrap().len(), 2);
    }

    #[test]
    fn system_absent_is_noop() {
        let mut body = json!({
            "model": "claude-3-5-sonnet",
            "messages": []
        });

        let result = rectify(&mut body);

        assert!(!result.applied);
        assert_eq!(result.removed_count, 0);
    }

    #[test]
    fn non_text_blocks_are_preserved() {
        let mut body = json!({
            "system": [
                {"type": "text", "text": "  X-Anthropic-Billing-Header: val"},
                {"type": "image", "source": {"type": "base64"}}
            ]
        });

        let result = rectify(&mut body);

        assert!(result.applied);
        assert_eq!(result.removed_count, 1);
        let system = body.get("system").unwrap().as_array().unwrap();
        assert_eq!(system.len(), 1);
        assert_eq!(system[0].get("type").unwrap().as_str().unwrap(), "image");
    }

    #[test]
    fn case_insensitive_matching() {
        let mut body = json!({
            "system": "  X-ANTHROPIC-BILLING-HEADER: something"
        });

        let result = rectify(&mut body);

        assert!(result.applied);
        assert_eq!(result.removed_count, 1);
    }

    #[test]
    fn body_not_object_is_noop() {
        let mut body = json!("just a string");

        let result = rectify(&mut body);

        assert!(!result.applied);
        assert_eq!(result.removed_count, 0);
    }

    #[test]
    fn multiple_billing_blocks_are_all_removed() {
        let mut body = json!({
            "system": [
                {"type": "text", "text": "x-anthropic-billing-header: val1"},
                {"type": "text", "text": "Keep this."},
                {"type": "text", "text": "x-anthropic-billing-header: val2"}
            ]
        });

        let result = rectify(&mut body);

        assert!(result.applied);
        assert_eq!(result.removed_count, 2);
        let system = body.get("system").unwrap().as_array().unwrap();
        assert_eq!(system.len(), 1);
        assert_eq!(
            system[0].get("text").unwrap().as_str().unwrap(),
            "Keep this."
        );
    }
}
