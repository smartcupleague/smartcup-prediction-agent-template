# IDL Artifacts

These are copied Sails IDL snapshots used by the personal prediction agent for read-only chain queries and guarded transaction-plan construction. Do not edit generated IDL by hand.

## Included

- `bolao_program.idl`
  - Current default BolaoCore IDL for the World Cup MVP profile.
  - Used for match reads, user bet reads, points, claim/refund status, `PlaceBet`, `SubmitPodiumPick`, and claim/refund planning.
- `bolao_program.freebet-v4.idl`
  - Future BolaoCore/freebet-aware migration snapshot.
  - Keep for protocol-migration checks only. Do not pair it with the current MVP BolaoCore program unless the SmartCup protocol team confirms the deployed program was upgraded.
- `freebet-ledger.idl`
  - Optional Freebet Ledger IDL.
  - Used only when `SMARTCUP_FREEBET_LEDGER_ID` is configured.
- `oracle_program.idl`
  - Optional oracle read IDL.
  - Used for result, pending-match, feeder/consensus, and VARA/USD price reads when configured.

## Refresh

Copy updated IDLs from the official SmartCup protocol repository, then rebuild and run the private smoke suite:

```bash
npm run check
npm run build
npm run telegram-private-smoke -- --format summary
```

Never refresh IDLs in isolation without confirming the configured program ids point to contracts that actually use those interfaces.
