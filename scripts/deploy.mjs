#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { argv, env as processEnv } from 'node:process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function run(cmd) {
    console.log(`$ ${cmd}`)
    execSync(cmd, { stdio: 'inherit' })
}

function loadDotVarsIntoEnv(filePath) {
    if (!existsSync(filePath)) return
    const content = readFileSync(filePath, 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eqIndex = line.indexOf('=')
        if (eqIndex <= 0) continue
        const key = line.slice(0, eqIndex).trim()
        const value = line.slice(eqIndex + 1).trim()
        if (!(key in processEnv)) {
            processEnv[key] = value
        }
    }
}

function replaceTopLevelDbId(text, dbId) {
    // Replace only the top-level database_id before the "env" section
    const envIdx = text.indexOf('\n    "env": {')
    const searchArea = envIdx !== -1 ? text.slice(0, envIdx) : text
    const token = '"database_id": '
    const rel = searchArea.indexOf(token)
    if (rel === -1) return text
    const abs = rel
    // Find quotes after token
    const startQuote = abs + token.length
    const firstQuoteIdx = searchArea.indexOf('"', startQuote)
    if (firstQuoteIdx === -1) return text
    const secondQuoteIdx = searchArea.indexOf('"', firstQuoteIdx + 1)
    if (secondQuoteIdx === -1) return text
    const before = searchArea.slice(0, firstQuoteIdx + 1)
    const after = searchArea.slice(secondQuoteIdx)
    const replaced = before + dbId + after
    return replaced + (envIdx !== -1 ? text.slice(envIdx) : '')
}

function replaceDbIdForEnvBlock(text, envLabel, dbId) {
    // Locate env d1_databases entry by database_name and replace following database_id value
    const nameMarker = `"database_name": "one-balance-${envLabel}"`
    const start = text.indexOf(nameMarker)
    if (start === -1) return text
    const blockSlice = text.slice(start)
    const token = '"database_id": '
    const rel = blockSlice.indexOf(token)
    if (rel === -1) return text
    const abs = start + rel
    const startQuote = abs + token.length
    const firstQuoteIdx = text.indexOf('"', startQuote)
    if (firstQuoteIdx === -1) return text
    const secondQuoteIdx = text.indexOf('"', firstQuoteIdx + 1)
    if (secondQuoteIdx === -1) return text
    return text.slice(0, firstQuoteIdx + 1) + dbId + text.slice(secondQuoteIdx)
}

function replaceTopLevelDbName(text, dbName) {
    const envIdx = text.indexOf('\n    "env": {')
    const searchArea = envIdx !== -1 ? text.slice(0, envIdx) : text
    const token = '"database_name": '
    const rel = searchArea.indexOf(token)
    if (rel === -1) return text
    const startQuote = rel + token.length
    const firstQuoteIdx = searchArea.indexOf('"', startQuote)
    if (firstQuoteIdx === -1) return text
    const secondQuoteIdx = searchArea.indexOf('"', firstQuoteIdx + 1)
    if (secondQuoteIdx === -1) return text
    const before = searchArea.slice(0, firstQuoteIdx + 1)
    const after = searchArea.slice(secondQuoteIdx)
    const replaced = before + dbName + after
    return replaced + (envIdx !== -1 ? text.slice(envIdx) : '')
}

function replaceDbNameForEnvBlock(text, envLabel, dbName) {
    const nameMarker = `"name": "one-balance-${envLabel}"`
    const start = text.indexOf(nameMarker)
    if (start === -1) return text
    const blockSlice = text.slice(start)
    const token = '"database_name": '
    const rel = blockSlice.indexOf(token)
    if (rel === -1) return text
    const abs = start + rel
    const firstQuoteIdx = text.indexOf('"', abs + token.length)
    if (firstQuoteIdx === -1) return text
    const secondQuoteIdx = text.indexOf('"', firstQuoteIdx + 1)
    if (secondQuoteIdx === -1) return text
    return text.slice(0, firstQuoteIdx + 1) + dbName + text.slice(secondQuoteIdx)
}

function replaceVarInEnvBlock(text, envLabel, varName, varValue) {
    const nameMarker = `"name": "one-balance-${envLabel}"`
    const start = text.indexOf(nameMarker)
    if (start === -1) return text
    const blockSlice = text.slice(start)
    const token = `"${varName}": `
    const rel = blockSlice.indexOf(token)
    if (rel === -1) return text
    const abs = start + rel
    const firstQuoteIdx = text.indexOf('"', abs + token.length)
    if (firstQuoteIdx === -1) return text
    const secondQuoteIdx = text.indexOf('"', firstQuoteIdx + 1)
    if (secondQuoteIdx === -1) return text
    return text.slice(0, firstQuoteIdx + 1) + varValue + text.slice(secondQuoteIdx)
}

function materializeWranglerConfig(envName) {
    // Ensure base config exists
    run('pnpm init:config')
    const configPath = resolve(process.cwd(), 'wrangler.jsonc')
    let cfg = readFileSync(configPath, 'utf8')

    // Replace AUTH_KEY (top-level and env blocks)
    const authKey = processEnv.AUTH_KEY
    if (authKey && authKey !== 'CHANGE_ME') {
        cfg = cfg.replaceAll('"AUTH_KEY": "CHANGE_ME"', `"AUTH_KEY": "${authKey}"`)
        cfg = cfg.replaceAll(/"AUTH_KEY":\s*"[^"]*"/g, `"AUTH_KEY": "${authKey}"`)
    }

    // Replace AI_GATEWAY (top-level and optionally per-env overrides)
    const aiGateway = processEnv.AI_GATEWAY
    if (aiGateway) {
        cfg = cfg.replaceAll(/"AI_GATEWAY":\s*"[^"]*"/g, `"AI_GATEWAY": "${aiGateway}"`)
    }
    const aiGatewayDev = processEnv.AI_GATEWAY_DEV
    if (aiGatewayDev) cfg = replaceVarInEnvBlock(cfg, 'dev', 'AI_GATEWAY', aiGatewayDev)
    const aiGatewayNormal = processEnv.AI_GATEWAY_NORMAL
    if (aiGatewayNormal) cfg = replaceVarInEnvBlock(cfg, 'normal', 'AI_GATEWAY', aiGatewayNormal)
    const aiGatewayProd = processEnv.AI_GATEWAY_PROD
    if (aiGatewayProd) cfg = replaceVarInEnvBlock(cfg, 'prod', 'AI_GATEWAY', aiGatewayProd)

    // Replace DB NAMEs with correct precedence
    const dbName = processEnv.DB_NAME
    if (dbName) cfg = replaceTopLevelDbName(cfg, dbName)
    const dbNameDev = processEnv.DB_NAME_DEV
    if (dbNameDev) cfg = replaceDbNameForEnvBlock(cfg, 'dev', dbNameDev)
    const dbNameNormal = processEnv.DB_NAME_NORMAL
    if (dbNameNormal) cfg = replaceDbNameForEnvBlock(cfg, 'normal', dbNameNormal)
    const dbNameProd = processEnv.DB_NAME_PROD
    if (dbNameProd) cfg = replaceDbNameForEnvBlock(cfg, 'prod', dbNameProd)

    // Replace DB IDs with correct precedence
    // 1) Top-level DB_ID (default, no --env)
    const dbId = processEnv.DB_ID
    if (dbId) cfg = replaceTopLevelDbId(cfg, dbId)
    // 2) Per-env overrides
    const devId = processEnv.DB_ID_DEV
    if (devId) cfg = replaceDbIdForEnvBlock(cfg, 'dev', devId)
    const normalId = processEnv.DB_ID_NORMAL
    if (normalId) cfg = replaceDbIdForEnvBlock(cfg, 'normal', normalId)
    const prodId = processEnv.DB_ID_PROD
    if (prodId) cfg = replaceDbIdForEnvBlock(cfg, 'prod', prodId)

    writeFileSync(configPath, cfg)
}

// Parse env/remote/dry-run from multiple sources to be npm/pnpm friendly
const rawArgs = argv.slice(2)
const envFlagIndex = rawArgs.indexOf('--env')
let envName = envFlagIndex > -1 ? rawArgs[envFlagIndex + 1] : undefined
// Fallback: first non-flag arg as env (supports `npm run deploycf normal`)
if (!envName) {
    const firstNonFlag = rawArgs.find(a => !a.startsWith('-'))
    if (firstNonFlag && firstNonFlag !== 'remote') envName = firstNonFlag
}
// Fallback: npm passes `--env normal` as npm_config_env
if (!envName && processEnv.npm_config_env) envName = processEnv.npm_config_env

const remote = rawArgs.includes('--remote') || rawArgs.includes('remote') || processEnv.npm_config_remote === 'true'
const dryRun =
    rawArgs.includes('--dry-run') ||
    rawArgs.includes('dry-run') ||
    processEnv.DRY_RUN === '1' ||
    processEnv.npm_config_dry_run === 'true'

// Load .dev.vars if present, without overriding existing env
loadDotVarsIntoEnv(resolve(process.cwd(), '.dev.vars'))
// Load env-specific vars (e.g., .dev.vars.dev) if --env is provided
if (envName) {
    loadDotVarsIntoEnv(resolve(process.cwd(), `.dev.vars.${envName}`))
}

// Prepare config and types (generate wrangler.jsonc with secrets)
materializeWranglerConfig(envName)
run('pnpm wrangler types')
run('pnpm prettier --write .')

if (dryRun) {
    console.log('[dry-run] 已生成 wrangler.jsonc（注入 AUTH_KEY/DB_ID 等变量），跳过迁移与部署。')
    console.log(
        '[dry-run] 计划执行：' +
            (remote ? 'pnpm migrate:remote' : 'pnpm migrate') +
            (envName ? ` -- --env ${envName}` : '')
    )
    console.log('[dry-run] 计划执行：' + ('wrangler deploy' + (envName ? ` --env ${envName}` : '')))
    process.exit(0)
}

// Apply migrations
if (remote) {
    run('pnpm migrate:remote' + (envName ? ` -- --env ${envName}` : ''))
} else {
    run('pnpm migrate' + (envName ? ` -- --env ${envName}` : ''))
}

// Re-materialize wrangler.jsonc in case any downstream step rewrote it
materializeWranglerConfig(envName)
run('pnpm wrangler types')

// Deploy
// Deploy to the right env. If empty string is desired for top-level, pass --env=""
const deployCmd = 'wrangler deploy' + (envName ? ` --env ${envName}` : '')
run(deployCmd)
