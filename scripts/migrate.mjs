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

// Map env -> D1 database name (keep in sync with wrangler.jsonc.tpl)
const dbName = envName === 'normal' ? 'one-balance-normal' : envName === 'prod' ? 'one-balance-prod' : 'one-balance-dev'

// Load .dev.vars if present
loadDotVarsIntoEnv(resolve(process.cwd(), '.dev.vars'))

run('pnpm init:config')
run('pnpm wrangler types')

const cmd = remote
    ? `wrangler d1 migrations apply ${dbName} --remote` + (envName ? ` --env ${envName}` : '')
    : `wrangler d1 migrations apply ${dbName} --local` + (envName ? ` --env ${envName}` : '')

run(cmd)
