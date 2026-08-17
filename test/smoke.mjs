// Self-contained smoke test for opencode-zen-compat. No DSH runtime needed.
// Run: node test/smoke.mjs
import fs from "node:fs";
import { apply } from "../lib/index.js";

let failures = 0;
const check = (label, ok) => {
	console.log((ok ? "PASS " : "FAIL ") + label);
	if (!ok) failures += 1;
};

// A stream shaped exactly like pi-ai's error path (via toStreamChunks).
async function* errorPathStream() {
	yield { type: "block-start", index: 0, blockType: "text" };
	yield { type: "text-delta", index: 0, text: "Hello! " };
	yield { type: "text-delta", index: 0, text: "Complete answer." };
	yield { type: "usage", usage: { input: 13, output: 6, totalTokens: 19 } };
	yield { type: "finish", reason: { kind: "error", failure: { message: "Stream ended without finish_reason", code: "UNKNOWN" } } };
}

const settingsSection = {
	providers: {
		"opencode-go-ext": { baseURL: "https://opencode.ai/zen/go/v1" },
		"my-gateway": { baseURL: "https://opencode.ai/zen/go/v1" },
	},
};

function makeCtx() {
	const registered = [];
	const ctx = {
		logger: { info: () => {} },
		settings: { get: (ns) => (ns === "llm-pi-ai" ? settingsSection : undefined) },
		on: (name, fn) => registered.push([name, fn]),
	};
	return { ctx, registered };
}

async function collect(stream) {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

// Wire apply() the way cordis does.
const { ctx, registered } = makeCtx();
apply(ctx);
check(
	"registers the llm/stream waterfall listener",
	registered.length === 1 && registered[0][0] === "llm/stream"
);
const handler = registered[0][1];

// 1) opencode route id -> terminal error rewritten to stop, content/usage intact.
const out1 = await collect(handler({ provider: "opencode-go-ext" }, () => errorPathStream()));
check("opencode-go-ext: terminal finish is stop", out1.at(-1).reason.kind === "stop");
check(
	"opencode-go-ext: text deltas preserved",
	out1.filter((c) => c.type === "text-delta").map((c) => c.text).join("") === "Hello! Complete answer."
);
check("opencode-go-ext: usage preserved", out1.find((c) => c.type === "usage")?.usage?.totalTokens === 19);

// 2) custom route name matched via settings baseURL.
const out2 = await collect(handler({ provider: "my-gateway" }, () => errorPathStream()));
check("my-gateway (settings baseURL): terminal finish is stop", out2.at(-1).reason.kind === "stop");

// 3) non-opencode route -> untouched (strict behavior kept).
const out3 = await collect(handler({ provider: "zivora" }, () => errorPathStream()));
check("zivora: error finish kept", out3.at(-1).reason.kind === "error");

// 4) opencode route with an unrelated error -> untouched.
async function* otherErrorStream() {
	yield { type: "finish", reason: { kind: "error", failure: { message: "402: quota exceeded", code: "QUOTA_EXCEEDED" } } };
}
const out4 = await collect(handler({ provider: "opencode-go" }, () => otherErrorStream()));
check("unrelated error not rewritten", out4.at(-1).reason.kind === "error");

// 5) settings service throwing -> id match still works.
const badCtx = { logger: { info: () => {} }, settings: { get: () => { throw new Error("boom"); } }, on: () => {} };
let h2; badCtx.on = (n, f) => { h2 = f; };
apply(badCtx);
const out5 = await collect(h2({ provider: "opencode-go" }, () => errorPathStream()));
check("settings throw tolerated, id match works", out5.at(-1).reason.kind === "stop");

const patch = fs.readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const modelCount = (patch.match(/^        - id: /gm) || []).length;
const effortCount = (patch.match(/^          reasoningEfforts:/gm) || []).length;
check("all 18 Plus models declare reasoning efforts", modelCount === 18 && effortCount === 18);
check("GPT-5.6 Luna exposes extended efforts", /gpt-5\.6-luna[\s\S]*?reasoningEfforts: \{ low: low, medium: medium, high: high, xhigh: xhigh, max: max \}/.test(patch));

if (failures > 0) {
	console.error(failures + " test(s) FAILED");
	process.exit(1);
}
console.log("All smoke tests passed.");
