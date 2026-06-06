# Render Deployment - SmartCup Indexer GraphQL API

Purpose: host the official SmartCup indexer GraphQL API away from the laptop while keeping Supabase as the dedicated Postgres read-model database.

This deploys only the GraphQL API. The processor/backfill should be deployed as a separate Render worker after the API is live.

## Architecture

```text
SmartPredictor agent
  -> Render Web Service: SmartCup indexer GraphQL API
  -> Supabase Postgres: indexer read model

Later:
Vara archive/RPC
  -> Render Worker: indexer processor/backfill
  -> Supabase Postgres
```

## Source Repo

- Repository: `https://github.com/smartcupleague/smartcupleague`
- Branch: `main`
- Root Directory: `indexer`

The GraphQL API code lives in the official SmartCup League repo under indexer/.

## Render Service

Create a new Render Web Service:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root Directory | `indexer` |
| Build Command | `YARN_PRODUCTION=false yarn install --production=false --frozen-lockfile && yarn build` |
| Start Command | `node lib/api.js` |
| Instance Type | Starter is acceptable for MVP |
| Auto Deploy | Optional; enable after first successful deploy |
| Health Check Path | `/graphiql` or leave empty for the first deploy |

Render web services must bind on `0.0.0.0` and the expected service port. The current API reads `GQL_PORT`, so set `GQL_PORT=10000` in Render.

The build command intentionally forces dev dependencies to install even with `NODE_ENV=production`, because TypeScript needs `@types/express` and `@types/cors` during `yarn build`.

## Environment Variables

Add these to the Render Web Service. Keep the real database URL secret in Render; do not commit it.

```dotenv
NODE_ENV=production
GQL_PORT=10000
DATABASE_URL=<supabase-session-pooler-url>
DB_URL=<same-supabase-session-pooler-url>
FRONTEND_URL=https://www.smartcupleague.com
```

Optional but useful for consistency with the indexer repo:

```dotenv
VARA_PROGRAM_ID=0x52f5f89954bbf1528f84eb1ca90100b47a6a50b0fe76e6ce31ed3ff55497ed98
VARA_RPC_URL=wss://archive-rpc.vara.network
VARA_RPC_RATE_LIMIT=20
VARA_ARCHIVE_URL=<confirmed-vara-mainnet-subsquid-archive-url>
VARA_FROM_BLOCK=26000000
```

The GraphQL API itself only needs `DATABASE_URL`, `GQL_PORT`, `FRONTEND_URL`, and `NODE_ENV`. The Vara archive/RPC fields are mainly for the later processor worker.

## Verification

After Render deploys, copy the service URL and test:

```bash
curl -s -X POST https://<render-service>.onrender.com/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ __typename }"}'
```

Expected:

```json
{"data":{"__typename":"Query"}}
```

Then update the agent `.env`:

```dotenv
SMARTCUP_INDEXER_GRAPHQL_URL=https://<render-service>.onrender.com/graphql
```

Run:

```bash
node dist/cli.js opponents --profiles 2 --format summary
```

Expected:

- `indexer.available: true`
- no GraphQL connection warnings

If `betCount` and `userStatCount` are still `0`, the API is working but processor/backfill is not yet populating Supabase.

## Security Notes

- This service is read-only GraphQL over the indexer tables.
- Do not add wallet mnemonics, private keys, Telegram bot tokens, Supabase service-role keys, or user payment data.
- Use a dedicated Supabase project/database for the indexer.
- Do not expose database credentials in logs or committed files.
- Keep transaction confirmation in the agent on direct BolaoCore/Oracle reads; the indexer is an enrichment/read-model source, not the canonical execution proof.

## Follow-Up

After the API is live:

1. Deploy the processor/backfill as a Render Worker.
2. Confirm `VARA_ARCHIVE_URL` and a safe `VARA_FROM_BLOCK`.
3. Re-run indexer reads until bets, user stats, rewards, claims, and activity records populate.
4. Reconcile the pre-agent manual prediction into memory/indexer docs.
