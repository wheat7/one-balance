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

function replaceDbIdForEnvBlock(text, envLabel, dbId) {
    // Replace the first REPLACE_WITH_DB_ID that appears within the env block identified by name
    const marker = `"name": "one-balance-${envLabel}"`
    const start = text.indexOf(marker)
    if (start === -1) return text
    const blockSlice = text.slice(start)
    const relIdx = blockSlice.indexOf('"database_id": "REPLACE_WITH_DB_ID"')
    if (relIdx === -1) return text
    const absIdx = start + relIdx
    return (
        text.slice(0, absIdx) +
        `"database_id": "${dbId}"` +
        text.slice(absIdx + '"database_id": "REPLACE_WITH_DB_ID"'.length)
    )
}

function materializeWranglerConfig(envName) {
    // Ensure base config exists
    run('pnpm init:config')
    const configPath = resolve(process.cwd(), 'wrangler.jsonc')
    let cfg = readFileSync(configPath, 'utf8')

    // Replace AUTH_KEY if provided
    const authKey = processEnv.AUTH_KEY
    if (authKey && authKey !== 'CHANGE_ME') {
        cfg = cfg.replaceAll('"AUTH_KEY": "CHANGE_ME"', `"AUTH_KEY": "${authKey}"`)
    }

    // Replace generic DB_ID first
    const dbId = processEnv.DB_ID
    if (dbId) {
        cfg = cfg.replaceAll('"database_id": "REPLACE_WITH_DB_ID"', `"database_id": "${dbId}"`)
    } else {
        // Replace per-env DB IDs if provided
        const devId = processEnv.DB_ID_DEV
        if (devId) cfg = replaceDbIdForEnvBlock(cfg, 'dev', devId)
        const normalId = processEnv.DB_ID_NORMAL
        if (normalId) cfg = replaceDbIdForEnvBlock(cfg, 'normal', normalId)
        const prodId = processEnv.DB_ID_PROD
        if (prodId) cfg = replaceDbIdForEnvBlock(cfg, 'prod', prodId)
    }

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

// Deploy
// Deploy to the right env. If empty string is desired for top-level, pass --env=""
const deployCmd = 'wrangler deploy' + (envName ? ` --env ${envName}` : '')
run(deployCmd)
