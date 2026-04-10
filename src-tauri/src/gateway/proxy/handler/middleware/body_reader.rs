//! Middleware: reads and validates request body size (10MB max).

use super::{MiddlewareAction, ProxyContext};
use crate::gateway::proxy::compute_observe_request;
use crate::gateway::proxy::handler::early_error::{
    build_early_error_log_ctx, early_error_contract, respond_early_error_with_enqueue,
    EarlyErrorKind,
};
use crate::gateway::util::{body_for_introspection, MAX_REQUEST_BODY_BYTES};
use axum::body::{to_bytes, Body};

pub(in crate::gateway::proxy::handler) struct BodyReaderMiddleware;

impl BodyReaderMiddleware {
    /// Reads the request body into `ctx.body_bytes` and parses introspection JSON.
    ///
    /// Also strips the `x-aio-provider-id` header (already consumed as `forced_provider_id`).
    pub(in crate::gateway::proxy::handler) async fn run(
        mut ctx: ProxyContext,
        body: Body,
    ) -> MiddlewareAction {
        ctx.headers.remove("x-aio-provider-id");

        match to_bytes(body, MAX_REQUEST_BODY_BYTES).await {
            Ok(bytes) => {
                ctx.body_bytes = bytes;
            }
            Err(err) => {
                let observe = compute_observe_request(
                    &ctx.cli_key,
                    &ctx.forwarded_path,
                    &ctx.headers,
                    None,
                );
                let contract = early_error_contract(EarlyErrorKind::BodyTooLarge);
                let log_ctx = build_early_error_log_ctx(
                    &ctx.state,
                    &ctx.started,
                    &ctx.trace_id,
                    &ctx.cli_key,
                    &ctx.method_hint,
                    &ctx.forwarded_path,
                    observe,
                    ctx.query.as_deref(),
                    ctx.created_at_ms,
                    ctx.created_at,
                );

                let resp = respond_early_error_with_enqueue(
                    &log_ctx,
                    contract,
                    body_too_large_message(&err.to_string()),
                    None,
                    None,
                    None,
                )
                .await;
                return MiddlewareAction::ShortCircuit(resp);
            }
        }

        let introspection_body = body_for_introspection(&ctx.headers, &ctx.body_bytes);
        ctx.introspection_json =
            serde_json::from_slice::<serde_json::Value>(introspection_body.as_ref()).ok();

        MiddlewareAction::Continue(ctx)
    }
}

pub(in crate::gateway::proxy::handler) fn body_too_large_message(err: &str) -> String {
    format!("failed to read request body: {err}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_too_large_message_includes_error() {
        let message = body_too_large_message("stream exceeded limit");
        assert!(message.contains("failed to read request body:"));
        assert!(message.contains("stream exceeded limit"));
    }
}
