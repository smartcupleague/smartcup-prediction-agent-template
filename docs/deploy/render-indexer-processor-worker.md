# Render Deployment - SmartCup Indexer Processor Worker

Purpose: host the official SmartCup indexer processor/backfill away from the laptop so Supabase gets populated with historical bets, user stats, rewards, final prize claims, refunds, and activity records.

This is the companion service to the hosted GraphQL API:

```text
Vara archive/RPC
  -> Render Background Worker: indexer processor/backfill
  -> Supabase Postgres
  -> Render Web Service: GraphQL API
  -> SmartPredictor agent
```

## Source Repo

- Repository: `https://github.com/smartcupleague/smartcupleague`
- Branch: `main`
- Root Directory: `indexer`

## Render Service

Create a new Render Background Worker:

| Setting | Value |
| --- | --- |
| Service Type | Background Worker |
| Runtime | Node |
| Root Directory | `indexer` |
| Build Command | `YARN_PRODUCTION=false yarn install --production=false --frozen-lockfile && yarn build` |
| Start Command | `node lib/main.js` |
| Instance Type | Starter is acceptable for MVP backfill, upgrade if catch-up is too slow |
| Auto Deploy | Optional; enable after first successful deploy |

Background Workers do not expose an HTTP port. Do not set `GQL_PORT` for the worker unless Render requires a placeholder; the worker does not serve GraphQL.

## Environment Variables

Use the same dedicated Supabase indexer database as the GraphQL API:

```dotenv
NODE_ENV=production
DATABASE_URL=<supabase-session-pooler-url>
DB_URL=<same-supabase-session-pooler-url>
```

World Cup MVP chain settings:

```dotenv
VARA_ARCHIVE_URL=<confirmed-vara-mainnet-subsquid-archive-url>
SQD_API_KEY=<sqd-gateway-api-key>
VARA_RPC_URL=wss://archive-rpc.vara.network
VARA_RPC_RATE_LIMIT=20
VARA_PROGRAM_ID=0x52f5f89954bbf1528f84eb1ca90100b47a6a50b0fe76e6ce31ed3ff55497ed98
VARA_FROM_BLOCK=26000000
```

`VARA_FROM_BLOCK=26000000` is the current safe backfill start configured locally. If the exact BolaoCore deploy block is confirmed later, lower or adjust this value only with a clear migration/backfill plan.

`SQD_API_KEY` is required for self-hosted processors that use legacy SQD v2 archive gateways such as `https://v2.archive.subsquid.io/network/vara`. Create it at `https://portal.sqd.dev`.

## Startup Expectations

On first deploy, the worker should:

1. connect to the Subsquid Vara archive gateway;
2. connect to `wss://archive-rpc.vara.network` for hot blocks;
3. decode `GearUserMessageSent` events for the World Cup MVP BolaoCore program;
4. write projected rows into Supabase.

The GraphQL API should then start showing non-zero rows for:

- bets
- user stats
- match rewards
- final prize claims
- refund claims
- activity records

## Verification

After the worker has been running, verify from the agent repo:

```bash
node dist/cli.js opponents --profiles 2 --format summary
```

Expected improvement:

- `indexer.available: true`
- `betCount` eventually greater than `0`
- `userStatCount` eventually greater than `0`
- fewer opponent-profile warnings about missing bet-history features

You can also query the hosted GraphQL API directly:

```bash
curl -s -X POST https://smartcupagent-indexer-graphql.onrender.com/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ allBets(first: 5) { nodes { id matchId user } } }"}'
```

## Schema Mismatch Recovery

If the worker reaches the archive, processes blocks, and then crashes with:

```text
QueryFailedError: column UserStat.total_refund_claimed_raw does not exist
```

the processor code is newer than the Supabase indexer schema. Pause the Render worker first, then apply this SQL in the Supabase SQL editor for the dedicated indexer database:

```sql
BEGIN;

ALTER TABLE public.user_stat
  ADD COLUMN IF NOT EXISTS total_refund_claimed_raw numeric NOT NULL DEFAULT '0';

CREATE TABLE IF NOT EXISTS public.refund_claim (
  id varchar NOT NULL,
  "user" varchar NOT NULL,
  amount_raw numeric NOT NULL,
  block_number bigint NOT NULL,
  "timestamp" timestamptz NOT NULL,
  CONSTRAINT "PK_refund_claim" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS "IDX_refund_claim_user" ON public.refund_claim ("user");
CREATE INDEX IF NOT EXISTS "IDX_refund_claim_block_number" ON public.refund_claim (block_number);
CREATE INDEX IF NOT EXISTS "IDX_refund_claim_timestamp" ON public.refund_claim ("timestamp");

TRUNCATE TABLE
  public.activity_record,
  public.refund_claim,
  public.final_prize_claim,
  public.match_reward,
  public.bet,
  public.user_stat,
  public.bolao_match
RESTART IDENTITY CASCADE;

UPDATE gear_processor.status
SET height = -1,
    hash = '0x',
    nonce = nonce + 1
WHERE id = 0;

TRUNCATE TABLE
  gear_processor.hot_change_log,
  gear_processor.hot_block,
  gear_processor.template_registry;

COMMIT;
```

Then restart the Render worker. The truncate/reset is intentional for MVP backfill: if the worker crashed after advancing its checkpoint, replaying from `VARA_FROM_BLOCK` keeps the projected tables consistent with the current code.

Longer term, add an official migration in the SmartCup indexer repo for `user_stat.total_refund_claimed_raw` and `refund_claim`, and keep `schema.graphql`, generated entities, and migrations in sync before future hosted deployments.

## Aggregate Projection Recovery

If GraphQL returns `bet` rows but `allUserStats` stays empty and `bolao_match.prize_pool_raw` remains `0` for matches with bets, check the official indexer handler before trusting the projection.

Observed root cause on 2026-06-03:

- the Sails decoder returned some numeric IDL payload values as strings;
- `onBetAccepted` saved the `Bet` and incremented `betsCount`;
- arithmetic such as `BigInt(match.prizePoolRaw) + stake` then threw because `stake` was not normalized to `bigint`;
- the per-event catch prevented the crash from stopping the whole worker, but user-stat, prize-pool, and activity updates were skipped.

Local official-repo repair:

- normalize decoded numeric payload fields before arithmetic in `indexer/src/handlers/bolao.ts`;
- add the refund-aware schema migration for `user_stat.total_refund_claimed_raw` and `refund_claim`;
- update `indexer/schema.graphql` so generated/query documentation matches the entity model.

After this patch is committed and deployed, pause the worker, reset projected tables/checkpoint with the recovery SQL above, and replay from `VARA_FROM_BLOCK`.

## Security Notes

- The processor writes only to the dedicated indexer Postgres database.
- Do not add wallet mnemonics, private keys, Telegram bot tokens, Supabase service-role keys, or user payment data.
- Treat `SQD_API_KEY` as a secret and store it only in Render environment variables.
- Use the Supabase Session Pooler URL stored only as Render secrets.
- Keep the GraphQL API read-only; the processor is the only indexer service that should write to the indexer tables.

## Multi-Tournament MVP Rule

For now, run one processor/API pair per tournament BolaoCore program.

For the next tournament, create a new worker/API pair with that tournament's:

- `VARA_PROGRAM_ID`
- `VARA_FROM_BLOCK`
- agent tournament profile
- `SMARTCUP_INDEXER_GRAPHQL_URL`

Do not merge multiple BolaoCore programs into this worker until the indexer schema has explicit `program_id` or `tournament_id` isolation.
