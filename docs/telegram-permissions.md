# Telegram Permission Model

Purpose: define how Telegram users are authorized before personal-agent bot commands are handled.

## Roles

`viewer`

- Default role for Telegram users.
- Can run public help/menu commands and read-only personal status where the bot allows it.
- Cannot approve wallet execution, change operator policy, or inspect operator-only reports.

`operator`

- Explicitly configured by numeric Telegram user id in `TELEGRAM_ADMIN_IDS`.
- Can run personal operator commands, generate saved reports, update defaults, and approve guarded wallet actions.
- Still cannot expose wallet private keys because the bot never stores them.

## Permission Source

Operator access is based only on numeric Telegram user ids:

```text
TELEGRAM_ADMIN_IDS=123456789,987654321
```

Do not use Telegram handles or display names for authorization. Handles can change and are easy to impersonate visually.

## Public Commands

Allowed command popup entries:

- `/start`
- `/menu`
- `/help`
- `/agent_status`
- `/freebet`
- `/claim_status`
- `/risk`
- `/objective`
- `/strategy`

Operator-only actions behind those commands still require `TELEGRAM_ADMIN_IDS`.

## Operator Actions

Allowed only for configured operators:

- saved decision previews
- guarded `PlaceBet` approval
- guarded `SubmitPodiumPick` approval
- guarded claim/refund planning
- policy changes
- stake/value changes
- report export
- chain prediction sync

## Fail-Closed Rules

- Unknown commands are denied or routed to help.
- Operator actions from non-operators are denied.
- Missing `TELEGRAM_ADMIN_IDS` means no operator action can run.
- Permission checks happen before parsing or executing approval, policy, stake, or wallet-action arguments.
- Natural language cannot submit transactions by itself.

## Safety Notes

- Operator permission does not imply wallet custody.
- Never request mnemonics, private keys, seed phrases, browser sessions, wallet JSON, or SubWallet exports.
- Keep wallet status, saved reports, and approval flows in private DMs.
- Use only public `0x...` wallet addresses for optional read-only lookups.
