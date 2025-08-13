{
    "$schema": "node_modules/wrangler/config-schema.json",
    // 默认（不指定 --env 时）部署配置
    "name": "one-balance",
    "main": "src/index.ts",
    "compatibility_date": "2025-06-20",
    "ai": {
        "binding": "AI"
    },
    "d1_databases": [
        {
            "binding": "DB",
            // Cloudflare D1 数据库名称（账户内唯一）
            "database_name": "one-balance",
            // 对应的数据库 ID（示例占位符，请在本地替换）
            "database_id": "REPLACE_WITH_DB_ID",
            "migrations_dir": "src/service/d1/migrations"
        }
    ],
    "vars": {
        // 默认环境变量（示例占位符，请勿提交真实密钥）
        "AUTH_KEY": "CHANGE_ME",
        "AI_GATEWAY": "one-balance",
        "CONSECUTIVE_429_THRESHOLD": "2"
    },
    "observability": {
        "enabled": true
    },

    // 下面可定义多个部署环境，使用 --env <envName> 切换
    "env": {
        // 显式：开发环境（dev）
        "dev": {
            "name": "one-balance-dev",
            "ai": { "binding": "AI" },
            "d1_databases": [
                {
                    "binding": "DB",
                    "database_name": "one-balance-dev",
                    "database_id": "REPLACE_WITH_DB_ID",
                    "migrations_dir": "src/service/d1/migrations"
                }
            ],
            "vars": {
                "AUTH_KEY": "CHANGE_ME",
                "AI_GATEWAY": "one-balance-dev",
                "CONSECUTIVE_429_THRESHOLD": "2"
            }
        },
        // 示例：日用环境
        "normal": {
            "name": "one-balance-normal",
            "ai": { "binding": "AI" },
            "d1_databases": [
                {
                    "binding": "DB",
                    "database_name": "one-balance-normal",
                    "database_id": "REPLACE_WITH_DB_ID",
                    "migrations_dir": "src/service/d1/migrations"
                }
            ],
            "vars": {
                "AUTH_KEY": "CHANGE_ME",
                "AI_GATEWAY": "one-balance-normal",
                "CONSECUTIVE_429_THRESHOLD": "2"
            }
        },

        // 示例：生产环境
        "prod": {
            "name": "one-balance-prod",
            "ai": { "binding": "AI" },
            "d1_databases": [
                {
                    "binding": "DB",
                    "database_name": "one-balance-prod",
                    "database_id": "REPLACE_WITH_DB_ID",
                    "migrations_dir": "src/service/d1/migrations"
                }
            ],
            "vars": {
                "AUTH_KEY": "CHANGE_ME",
                "AI_GATEWAY": "one-balance-prod",
                "CONSECUTIVE_429_THRESHOLD": "2"
            }
        }
    }
}