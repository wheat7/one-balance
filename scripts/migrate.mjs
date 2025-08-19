#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { argv, env as processEnv } from 'node:process'
import { existsSync, readFileSync } from 'node:fs'
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

const envArgIndex = argv.indexOf('--env')
const envName = envArgIndex > -1 ? argv[envArgIndex + 1] : undefined
const remote = argv.includes('--remote')
const dryRun = argv.includes('--dry-run') || processEnv.DRY_RUN === '1'

// Map env -> D1 database name (can be overridden via vars)
let dbName = envName === 'normal' ? 'one-balance-normal' : envName === 'prod' ? 'one-balance-prod' : 'one-balance-dev'
if (processEnv.DB_NAME) dbName = processEnv.DB_NAME
if (envName === 'dev' && processEnv.DB_NAME_DEV) dbName = processEnv.DB_NAME_DEV
if (envName === 'normal' && processEnv.DB_NAME_NORMAL) dbName = processEnv.DB_NAME_NORMAL
if (envName === 'prod' && processEnv.DB_NAME_PROD) dbName = processEnv.DB_NAME_PROD

// Load .dev.vars if present
loadDotVarsIntoEnv(resolve(process.cwd(), '.dev.vars'))
// Load env-specific vars (e.g., .dev.vars.dev) if --env is provided
if (envName) {
    loadDotVarsIntoEnv(resolve(process.cwd(), `.dev.vars.${envName}`))
}

// Assume wrangler.jsonc already materialized by deploy script.
// If running standalone, ensure wrangler.jsonc exists first.
if (!existsSync(resolve(process.cwd(), 'wrangler.jsonc'))) {
    console.warn('[migrate] wrangler.jsonc not found. Run deploy script or init config first.')
}
run('pnpm wrangler types')

if (dryRun) {
    console.log('[dry-run] 仅生成类型和配置，不执行 D1 迁移。')
    console.log(
        '[dry-run] 计划执行：' +
            (remote
                ? `wrangler d1 migrations apply ${dbName} --remote` + (envName ? ` --env ${envName}` : '')
                : `wrangler d1 migrations apply ${dbName} --local` + (envName ? ` --env ${envName}` : ''))
    )
    process.exit(0)
}

const cmd = remote
    ? `wrangler d1 migrations apply ${dbName} --remote` + (envName ? ` --env ${envName}` : '')
    : `wrangler d1 migrations apply ${dbName} --local` + (envName ? ` --env ${envName}` : '')

run(cmd)
