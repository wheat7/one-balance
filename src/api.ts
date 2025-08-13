import * as keyService from './service/key'
import * as util from './util'
import type * as schema from './service/d1/schema'
import { parseProviderError } from './error'

const PROVIDER_CUSTOM_AUTH_HEADER: Record<string, string> = {
    'google-ai-studio': 'x-goog-api-key',
    anthropic: 'x-api-key',
    elevenlabs: 'x-api-key',
    'azure-openai': 'api-key',
    cartesia: 'X-API-Key'
}

// A temporary, in-memory blacklist for keys that have recently failed with a retriable error.
// The key is the key's ID, and the value is the timestamp when it can be used again.
const recentFailures = new Map<string, number>()
const RECENT_FAILURE_COOLDOWN_MS = 5000 // 5 seconds

// Using an in-memory Map to count consecutive 429s is a design choice to prioritize performance and minimize costs.
// Limitation: This counter is local to each worker instance and not shared globally.
let consecutive429Count: Map<string, number> = new Map()
export async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const restResource = url.pathname.substring('/api/'.length) + url.search

    const provider = restResource.split('/')[0]
    const authKey = getAuthKey(request, provider)
    if (!util.isValidAuthKey(authKey, env.AUTH_KEY)) {
        return new Response('Invalid auth key', { status: 403 })
    }

    const realProviderAndModel = await extractRealProviderAndModel(request, restResource, provider)
    if (!realProviderAndModel) {
        return new Response('Not supported request: valid provider or model not found', { status: 400 })
    }

    return await forward(request, env, ctx, restResource, realProviderAndModel.provider, realProviderAndModel.model)
}

async function extractRealProviderAndModel(
    request: Request,
    restResource: string,
    provider: string
): Promise<{ provider: string; model: string } | null> {
    const model = await extractModel(request, restResource)
    if (!model) {
        return null
    }
    if (provider !== 'compat') {
        return { provider, model }
    }

    // find the real provider from model (e.g. google-ai-studio/gemini-2.0-flash)
    // see https://developers.cloudflare.com/ai-gateway/chat-completion/#curl
    const realProvider = model.split('/')[0]
    if (!realProvider) {
        // bad request
        return null
    }
    const realModel = model.split('/')[1]
    if (!realModel) {
        // bad request
        return null
    }

    return { provider: realProvider, model: realModel }
}

async function extractModel(request: Request, restResource: string): Promise<string | null> {
    if (request.method === 'POST' && request.body) {
        const model = await extractModelFromBody(request)
        if (model) return model
    }

    return extractModelFromPath(restResource)
}

async function extractModelFromBody(request: Request): Promise<string | null> {
    try {
        const body = (await request.clone().json()) as { model: string }
        return body.model || null
    } catch {
        return null
    }
}

function extractModelFromPath(restResource: string): string | null {
    const parts = restResource.split('/models/')
    if (parts.length > 1) {
        return parts[1].split(':')[0]
    }

    return null
}

async function forward(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    restResource: string,
    provider: string,
    model: string
): Promise<Response> {
    let availableKeys = await keyService.listAvailableKeysViaCache(env, provider, model)
    if (availableKeys.length === 0) {
        return new Response(`No available keys for model ${model}`, { status: 503 })
    }

    const body = request.body ? await request.arrayBuffer() : null
    const MAX_RETRIES = 10
    for (let i = 0; i < MAX_RETRIES; i++) {
        if (availableKeys.length === 0) {
            return new Response(`No available keys for model ${model} after retries`, { status: 503 })
        }

        const selectedKey = selectKey(availableKeys)
        if (!selectedKey) {
            return new Response(`No available keys for model ${model}, all are temporarily cooling down.`, {
                status: 503
            })
        }
        const reqToGateway = await makeGatewayRequest(
            request.method,
            request.headers,
            body,
            env,
            restResource,
            selectedKey.key
        )
        const respFromGateway = await fetch(reqToGateway)
        if (respFromGateway.ok) {
            consecutive429Count.delete(selectedKey.key)
            return respFromGateway
        }

        // Standardize provider error
        const unifiedError = await parseProviderError(provider, respFromGateway)
        console.error(`Error from ${provider}: ${unifiedError.message}`, unifiedError.original_error)

        switch (unifiedError.code) {
            case 'invalid_api_key':
            case 'permission_denied':
                ctx.waitUntil(keyService.setKeyStatus(env, provider, selectedKey.id, 'blocked'))
                availableKeys.splice(availableKeys.indexOf(selectedKey), 1)
                console.error(`Key ${selectedKey.key} blocked due to: ${unifiedError.code}`)
                continue

            case 'rate_limit_exceeded': {
                const cooldownSeconds = await analyze429CooldownSeconds(env, respFromGateway, provider, selectedKey.key)
                ctx.waitUntil(
                    keyService.setKeyModelCooldownIfAvailable(env, selectedKey.id, provider, model, cooldownSeconds)
                )
                // Add to temporary black list to avoid stampede under concurrency
                recentFailures.set(selectedKey.id, Date.now() + RECENT_FAILURE_COOLDOWN_MS)
                availableKeys.splice(availableKeys.indexOf(selectedKey), 1)
                console.warn(
                    `Key ${selectedKey.key} cooling down for model ${model} for ${cooldownSeconds}s due to rate limit.`
                )
                continue
            }

            case 'service_unavailable':
            case 'internal_server_error':
                // Potentially temporary; retry with different key
                recentFailures.set(selectedKey.id, Date.now() + RECENT_FAILURE_COOLDOWN_MS)
                availableKeys.splice(availableKeys.indexOf(selectedKey), 1)
                console.warn(`Retrying due to temporary error: ${unifiedError.code}`)
                continue

            case 'bad_request':
            case 'not_found':
            case 'unknown_error':
            default:
                return new Response(JSON.stringify(unifiedError), {
                    status: unifiedError.status,
                    headers: { 'Content-Type': 'application/json' }
                })
        }
    }

    return new Response('Internal server error after retries', { status: 500 })
}

function getAuthKey(request: Request, provider: string): string {
    let header = PROVIDER_CUSTOM_AUTH_HEADER[provider]
    if (!header) {
        header = 'Authorization'
    }

    let apiKeyStr = request.headers.get(header)
    if (!apiKeyStr) {
        return ''
    }

    if (header === 'Authorization') {
        apiKeyStr = apiKeyStr.replace(/^Bearer\s+/, '')
    }
    return apiKeyStr
}

function selectKey(keys: schema.Key[]): schema.Key | null {
    const now = Date.now()

    // Filter out keys that are in the temporary failure list.
    const trulyAvailableKeys = keys.filter(key => {
        const failureTimestamp = recentFailures.get(key.id)
        if (failureTimestamp && now < failureTimestamp) {
            return false
        }
        return true
    })

    // Cleanup expired entries from the failure map
    for (const [keyId, timestamp] of recentFailures.entries()) {
        if (now >= timestamp) {
            recentFailures.delete(keyId)
        }
    }

    if (trulyAvailableKeys.length === 0) {
        return null
    }

    const randomKey = trulyAvailableKeys[Math.floor(Math.random() * trulyAvailableKeys.length)]
    console.info(`selected an available key ${randomKey.key} to try`)
    return randomKey
}

async function makeGatewayRequest(
    method: string,
    headers: Headers,
    body: ArrayBuffer | null,
    env: Env,
    restResource: string,
    key: string
): Promise<Request> {
    const newHeaders = new Headers(headers)
    setAuthHeader(newHeaders, restResource, key)

    // TODO: may use url from env directly for low latency.
    let base = await env.AI.gateway(env.AI_GATEWAY).getUrl()
    if (!base.endsWith('/')) {
        base += '/'
    }
    const url = `${base}${restResource}`

    return new Request(url, {
        method: method,
        headers: newHeaders,
        body: body,
        redirect: 'follow'
    })
}

function setAuthHeader(headers: Headers, restResource: string, key: string) {
    const provider = restResource.split('/')[0]

    let header = PROVIDER_CUSTOM_AUTH_HEADER[provider]
    if (header) {
        headers.set(header, key)
    } else {
        headers.set('Authorization', `Bearer ${key}`)
    }
}

async function keyIsInvalid(respFromGateway: Response, provider: string): Promise<boolean> {
    if (provider !== 'google-ai-studio') {
        return false // TODO: support other providers
    }

    if (respFromGateway.status !== 400) {
        return false
    }

    try {
        const body = await respFromGateway.clone().json()
        const detail = getGoogleAiStudioErrorDetail(body, 'type.googleapis.com/google.rpc.ErrorInfo')
        return detail?.reason === 'API_KEY_INVALID' // may already deleted.
    } catch {
        return false
    }
}

// Using an in-memory Map to count consecutive 429s is a design choice to prioritize performance and minimize costs.
// - Why not use D1 (DB)? To avoid database writes on every 429 error, which would increase load and latency. We only write to the DB when a key needs to be cooled down.
// - Why not use KV? The free tier has low write quotas. Also, KV's eventual consistency makes it unsuitable for precise, real-time counting.
// Limitation: This counter is local to each worker instance and not shared globally. If requests for the same key are routed to different instances, the count may be inaccurate.
// However, for short-lived consecutive requests, Cloudflare often routes them to the same instance, making this a practical trade-off.

async function analyze429CooldownSeconds(
    env: Env,
    respFromGateway: Response,
    provider: string,
    key: string
): Promise<number> {
    const count = (consecutive429Count.get(key) || 0) + 1
    consecutive429Count.set(key, count)

    if (count >= Number(env.CONSECUTIVE_429_THRESHOLD)) {
        consecutive429Count.delete(key)
        console.error(`key ${key} triggered long cooldown after ${env.CONSECUTIVE_429_THRESHOLD} consecutive 429s`)
        return provider === 'google-ai-studio' ? util.getSecondsUntilMidnightPT() : 24 * 60 * 60
    }

    if (provider !== 'google-ai-studio') {
        return 65
    }

    try {
        const errorBody = await respFromGateway.clone().json()
        const quotaFailureDetail = getGoogleAiStudioErrorDetail(
            errorBody,
            'type.googleapis.com/google.rpc.QuotaFailure'
        )
        if (quotaFailureDetail) {
            const violations = quotaFailureDetail.violations || []
            for (const violation of violations) {
                if (violation.quotaId === 'GenerateRequestsPerDayPerProjectPerModel-FreeTier') {
                    return util.getSecondsUntilMidnightPT() // Requests per day (RPD) quotas reset at midnight Pacific time
                }
            }
        }

        const retryInfoDetail = getGoogleAiStudioErrorDetail(errorBody, 'type.googleapis.com/google.rpc.RetryInfo')
        if (retryInfoDetail && retryInfoDetail.retryDelay) {
            const retrySeconds = parseInt(retryInfoDetail.retryDelay.replace('s', ''))
            console.warn(`Detected RPM limit, using retry-after: ${retrySeconds}s.`)
            return retrySeconds + 5 // Use a slightly larger buffer
        }
    } catch (error) {
        console.error('failed to parse 429 response, fallback to 65 seconds', error)
    }

    return 65
}

function getGoogleAiStudioErrorDetail(body: any, type: string): any | null {
    let errorBody = body
    if (Array.isArray(body) && body.length > 0) {
        errorBody = body[0]
    }

    const details = errorBody.error?.details || []
    for (const detail of details) {
        if (detail['@type'] === type) {
            return detail
        }
    }

    return null
}
