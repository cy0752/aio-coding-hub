mod support;

use serde_json::Value;

fn json_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn json_str<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

#[test]
fn settings_set_accepts_cx2cc_camel_case_payload_keys() {
    let app = support::TestApp::new();
    let handle = app.handle();

    let result = aio_coding_hub_lib::test_support::settings_set_via_command_json(
        &handle,
        serde_json::json!({
            "preferredPort": 37123,
            "autoStart": false,
            "logRetentionDays": 7,
            "failoverMaxAttemptsPerProvider": 5,
            "failoverMaxProvidersToTry": 5,
            "cx2CcModelReasoningEffort": "xhigh",
            "cx2CcServiceTier": "fast",
            "cx2CcDisableResponseStorage": false,
            "cx2CcEnableReasoningToThinking": false,
            "cx2CcDropStopSequences": false,
            "cx2CcCleanSchema": false,
            "cx2CcFilterBatchTool": false
        }),
    )
    .expect("settings_set via command should succeed");

    let settings = result.get("settings").expect("settings payload");
    assert_eq!(json_str(settings, "cx2cc_model_reasoning_effort"), "xhigh");
    assert_eq!(json_str(settings, "cx2cc_service_tier"), "fast");
    assert!(!json_bool(settings, "cx2cc_disable_response_storage"));
    assert!(!json_bool(settings, "cx2cc_enable_reasoning_to_thinking"));
    assert!(!json_bool(settings, "cx2cc_drop_stop_sequences"));
    assert!(!json_bool(settings, "cx2cc_clean_schema"));
    assert!(!json_bool(settings, "cx2cc_filter_batch_tool"));
}
