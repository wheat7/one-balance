#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { argv } from 'node:process'

function run(cmd) {
    console.log(`$ ${cmd}`)
    execSync(cmd, { stdio: 'inherit' })
}

const envArgIndex = argv.indexOf('--env')
const envName = envArgIndex > -1 ? argv[envArgIndex + 1] : undefined
const remote = argv.includes('--remote')

// Map env -> D1 database name (keep in sync with wrangler.jsonc.tpl)
const dbName = envName === 'normal' ? 'one-balance-normal' : envName === 'prod' ? 'one-balance-prod' : 'one-balance-dev'

run('pnpm init:config')
run('pnpm wrangler types')

const cmd = remote
    ? `wrangler d1 migrations apply ${dbName} --remote` + (envName ? ` --env ${envName}` : '')
    : `wrangler d1 migrations apply ${dbName} --local` + (envName ? ` --env ${envName}` : '')

run(cmd)
