#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { argv, env as processEnv } from 'node:process'

function run(cmd) {
    console.log(`$ ${cmd}`)
    execSync(cmd, { stdio: 'inherit' })
}

// Parse env/remote from multiple sources to be npm/pnpm friendly
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

// Prepare config and types
run('pnpm init:config')
run('pnpm wrangler types')
run('pnpm prettier --write .')

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
