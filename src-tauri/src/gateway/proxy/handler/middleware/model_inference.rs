//! Middleware: infers the requested model from path/query/JSON body and computes
//! observe_request flag.

use super::{MiddlewareAction, ProxyContext};
use crate::gateway::proxy::compute_observe_request;
use crate::gateway::util::infer_requested_model_info;

pub(in crate::gateway::proxy::handler) struct ModelInferenceMiddleware;

impl ModelInferenceMiddleware {
    pub(in crate::gateway::proxy::handler) fn run(mut ctx: ProxyContext) -> MiddlewareAction {
        let model_info = infer_requested_model_info(
            &ctx.forwarded_path,
            ctx.query.as_deref(),
            ctx.introspection_json.as_ref(),
        );
        ctx.requested_model = model_info.model;
        ctx.requested_model_location = model_info.location;

        ctx.observe_request = compute_observe_request(
            &ctx.cli_key,
            &ctx.forwarded_path,
            &ctx.headers,
            ctx.introspection_json.as_ref(),
        );

        MiddlewareAction::Continue(Box::new(ctx))
    }
}
