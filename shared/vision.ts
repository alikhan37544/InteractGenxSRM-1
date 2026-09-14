// Shared vision-model detection utilities.
//
// LM Studio's internal API (`/api/v0/models`) reports each model's `type`
// ("vlm" = vision language model) and `state` ("loaded" | "not-loaded") — the
// authoritative source. The OpenAI-compatible `/v1/models` endpoint reports
// neither, so both are queried and merged here.
//
// The registry is populated whenever either agent server refreshes its model
// list (startup + every `/models` call). `isVisionModel()` uses the registry
// first and falls back to a name heuristic for non-LM Studio backends.

const visionModelIds = new Set<string>();

export interface LmStudioModelInfo {
    models: string[];
    loadedModel: string | null;
    loadedModels: string[];
    visionModels: string[];
}

/**
 * Record which models are known to be vision-capable (from `type: "vlm"`).
 */
export function registerVisionModels(ids: string[]): void {
    for (const id of ids) {
        if (typeof id === 'string' && id.trim()) {
            visionModelIds.add(id.trim());
        }
    }
}

/**
 * Name-based fallback for backends that do not report model type metadata.
 * Kept deliberately narrow so a plain text model is never assumed to be a
 * vision model (sending an image to a text-only model fails).
 */
const VISION_NAME_RE =
    /(?:vision|vlm|llava|internvl|intern-vl|moondream|phi-?3[\s._-]?vision|pixtral|idefics|minicpm|bunny|fuyu|cogvlm|qwen2[.\-]?vl|qwen3[\s._-]?vl|gemma-3|gemma-4|gemini|gpt-4o|gpt-4\.1|gpt-4\.5|claude-3|claude-4|o[0-9]-mini|glm-4\.6v|glm-ocr)/i;

/**
 * True when the given model id is known to accept image input.
 */
export function isVisionModel(modelId?: string | null): boolean {
    const id = (modelId || '').trim();
    if (!id) return false;
    if (visionModelIds.has(id)) return true;
    return VISION_NAME_RE.test(id);
}

/**
 * Query LM Studio for the available models, which one(s) are currently loaded,
 * and which are vision-capable. Merges the OpenAI-compatible `/v1/models`
 * endpoint (ids) with the internal `/api/v0/models` endpoint (state + type).
 * Never throws — returns an empty-ish result when LM Studio is unreachable.
 */
export async function fetchLmStudioModelInfo(lmStudioUrl: string): Promise<LmStudioModelInfo> {
    const base = lmStudioUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    const info: LmStudioModelInfo = {
        models: [],
        loadedModel: null,
        loadedModels: [],
        visionModels: [],
    };

    const responses = await Promise.allSettled([
        fetch(`${lmStudioUrl}/models`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(5000) }),
    ]);

    // v1 gives every model id; v0 additionally reports state/type — and lets
    // us filter out embedding models.
    const v1Ids: string[] = [];
    const v0Ids: string[] = [];
    const v0Mentioned = new Set<string>();
    let hasV0 = false;

    for (const result of responses) {
        if (result.status !== 'fulfilled' || !result.value.ok) continue;
        let payload: any;
        try {
            payload = await result.value.json();
        } catch {
            continue;
        }
        if (!payload || !Array.isArray(payload.data)) continue;

        const isV0 = (
            typeof payload.data[0]?.state === 'string' ||
            typeof payload.data[0]?.is_loaded === 'boolean' ||
            typeof payload.data[0]?.type === 'string'
        );

        for (const model of payload.data) {
            const id = typeof model?.id === 'string' ? model.id.trim() : '';
            if (!id) continue;

            if (isV0) {
                hasV0 = true;
                v0Mentioned.add(id);
                // Embedding models cannot be used for chat.
                if (model.type === 'embeddings') continue;
                if (!v0Ids.includes(id)) v0Ids.push(id);
                if (model.state === 'loaded' || model.is_loaded === true) {
                    info.loadedModels.push(id);
                }
                if (model.type === 'vlm') {
                    info.visionModels.push(id);
                }
            } else if (!v1Ids.includes(id)) {
                v1Ids.push(id);
            }
        }
    }

    // Prefer the v0 list (complete + embeddings filtered), then append any
    // ids that only v1 knows about (older LM Studio without the v0 endpoint).
    const preferred = hasV0 ? v0Ids : v1Ids;
    info.models = [...preferred];
    for (const id of v1Ids) {
        if (hasV0 ? !v0Mentioned.has(id) : !preferred.includes(id)) {
            info.models.push(id);
        }
    }

    info.loadedModel = info.loadedModels[0] || null;
    registerVisionModels(info.visionModels);

    return info;
}