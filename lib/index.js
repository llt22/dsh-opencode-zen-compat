/**
 * opencode-zen-compat — DSH plugin.
 *
 * Two tightly-coupled jobs for the opencode Zen gateway
 * (https://opencode.ai/zen/go/v1):
 *
 * 1) STREAM COMPAT: the Zen gateway streams chat completions with a
 *    non-standard terminator — it never sends a `finish_reason` and never
 *    sends the `data: [DONE]` SSE sentinel, the HTTP body just closes
 *    (typically after a final chunk like {"choices":[],"cost":"0"}). pi-ai's
 *    openai-completions adapter treats that as a truncated stream and emits
 *    `Stream ended without finish_reason`, turning an otherwise complete
 *    response into a failed turn. This plugin intercepts the llm/stream
 *    waterfall and rewrites that exact terminal error finish into a normal
 *    stop finish — but ONLY for provider routes that are opencode-based
 *    (provider id containing "opencode", or a route whose llm-pi-ai settings
 *    baseURL contains "opencode.ai"). Every other provider keeps the strict
 *    truncation detection.
 *
 * 2) PROVIDER REGISTRY (v1.1.0+): the stock pi-ai catalog lists only 16
 *    opencode-go models; the cordis.patch.yml in this package injects the
 *    full custom provider "opencode-go-plus" (18 verified models, adding
 *    gpt-5.6-luna / glm-5.3 / qwen3.8-max) into the llm-pi-ai settings BASE
 *    layer. The user settings.yaml stays untouched and uninstalling this
 *    plugin removes the provider row completely.
 *
 * If upstream pi-ai ever fixes the stream terminator and catches up on the
 * model catalog, this whole plugin can be removed again.
 */

export const name = "opencode-zen-compat";
export const inject = ["llm", "settings"];

/** The exact pi-ai error message produced when a stream closes without finish_reason. */
const MISSING_FINISH_REASON = "Stream ended without finish_reason";

/**
 * Whether one provider route talks to opencode Zen.
 * Matches by route id first (covers opencode / opencode-go / opencode-go-plus
 * and any future opencode-named route), then by the configured baseURL from
 * the llm-pi-ai settings section (covers custom route names).
 */
function isOpencodeRoute(ctx, provider) {
	if (typeof provider !== "string" || provider.length === 0) return false;
	if (/opencode/i.test(provider)) return true;
	try {
		const section = ctx.settings.get("llm-pi-ai");
		const baseURL = section?.providers?.[provider]?.baseURL;
		return typeof baseURL === "string" && baseURL.includes("opencode.ai");
	} catch {
		return false;
	}
}

/**
 * Rewrite the terminal "Stream ended without finish_reason" error finish into
 * a stop finish, keeping every other chunk (deltas, usage) untouched. The
 * assembled content is identical: text deltas were already streamed, and the
 * finish chunk only decides how the turn ends.
 */
async function* tolerateMissingFinishReason(stream) {
	for await (const chunk of stream) {
		if (
			chunk?.type === "finish" &&
			chunk.reason?.kind === "error" &&
			chunk.reason.failure?.message === MISSING_FINISH_REASON
		) {
			yield { ...chunk, reason: { kind: "stop" } };
		} else {
			yield chunk;
		}
	}
}

export function apply(ctx) {
	ctx.logger.info("opencode-zen-compat: opencode-go-plus provider registered via base patch; stream-compat hook active");
	ctx.on("llm/stream", (options, next) => {
		const stream = next();
		if (!isOpencodeRoute(ctx, options?.provider)) return stream;
		ctx.logger.info(
			`opencode-zen-compat: tolerating missing finish_reason for provider "${options?.provider}"`,
		);
		return tolerateMissingFinishReason(stream);
	});
}
