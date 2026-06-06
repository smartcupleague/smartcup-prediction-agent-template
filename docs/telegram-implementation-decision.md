# Telegram Implementation Decision

Decision: use a direct Telegram runner for the first personal-agent template.

The current runner is dependency-light and uses built-in Node APIs for polling/webhook transport. It routes Telegram messages into the same agent modules and smoke harnesses used by the CLI.

## Why

- The immediate product target is Telegram only.
- A direct runner is easy for a new user to run locally.
- Polling works well for the default local setup and Render Background Worker setup.
- Webhook mode remains available as the advanced hosted path.
- The agent modules already contain the prediction, report, safety, and policy logic.

## Why Not A Multi-Platform SDK First

A unified chat SDK can be useful later if the agent expands to Discord, Slack, Teams, or a web chat. For the first personal Telegram template, it adds an abstraction before users need it.

Keep handlers thin and route them through reusable service functions so another adapter can reuse the same logic later.

## Implementation Boundary

The Telegram bot should:

- support polling first and webhook later
- read config from `.env` or host environment variables
- use `MemoryStore` for saved reports, preferences, parser telemetry, and transaction plans
- check `TELEGRAM_ADMIN_IDS` before operator actions
- keep personal report output friendly and free of raw command logs
- never request or store wallet secrets

The Telegram bot should not:

- shell out to CLI commands for core business logic where module calls are available
- expose operator actions to non-operators
- sign transactions from natural-language text alone
- run multiple polling/webhook processes for the same bot token

## Future Revisit Trigger

Revisit a multi-platform chat SDK when one of these becomes true:

- SmartCup agents need Discord, Slack, Teams, or web chat parity.
- The project needs one shared conversation state model across multiple messaging platforms.
- Telegram has proven traction and multi-channel distribution becomes a clear requirement.
