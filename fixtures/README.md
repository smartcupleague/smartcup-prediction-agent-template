# Fixtures

This folder is reserved for optional future file-based fixtures.

The current template does not require fixture files to run. The private Telegram smoke suite uses in-code smoke fixtures in `src/cli.ts` so a clean clone can verify parser routing, permissions, local memory, transaction-plan safety, and friendly Telegram output without external services.

Manual provider examples currently live in `.env.example`:

- `SMARTCUP_ODDS_MANUAL_JSON`
- `SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON`

Add files here later only when a provider adapter, model regression, or mocked chain/indexer/API test needs reusable JSON fixtures.
