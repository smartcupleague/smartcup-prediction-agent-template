# Tournament Profiles

Tournament profiles keep SmartPredictor-01 from hard-coding World Cup assumptions into the agent runtime.

Each tournament gets one JSON file that follows `smartpredictor.tournament-profile.v1`:

- identity: `tournamentId`, `slug`, `name`, `season`, `timezone`
- deployed programs: `bolaoCore`, `oracle`, and optional `freebetLedger`
- providers: fixture source plus optional odds, news, and injury providers
- cutoff policy: SmartCup cutoff minutes and agent safety buffer
- entry policy: dynamic minimum entry or fixed operator value
- scoring policy: base exact-score/outcome points and whether phase weights apply
- reward split: match winner pool, final prize pool, protocol fee in basis points
- final prize distribution and tie-break handling
- phases: SmartCup phase names, points weights, optional date windows, and match ID ranges
- podium pick: enabled window metadata, or `null` for tournaments without a podium/championship pick

Profiles are baselines, not frozen truth. Before planning matches or championship picks, the agent should reconcile the profile with live BolaoCore state so newly registered phases, contract weights, and `r32_lock_time` are picked up during the tournament:

```sh
npm run profile
```

## Files

- `worldcup-2026.mvp.json`: current SmartCup World Cup MVP profile.
- `templates/mini-friendly.template.json`: copy this for 10-20 match friendly mini tournaments.

## Adding A Mini Tournament

1. Copy `templates/mini-friendly.template.json` to a new profile file, for example `mini-friendly-2026-06.json`.
2. Replace `tournamentId`, `slug`, `name`, and `season`.
3. Replace `programs.bolaoCore` and `programs.oracle` with the deployed tournament programs. Set `programs.freebetLedger` when a Freebet Ledger is deployed for the tournament; otherwise leave it `null`.
4. Set `matchCount` once the selected match list is final.
5. Fill the phase `startsAt`, `endsAt`, and `smartcupPhaseNames` from the deployed contract.
6. Keep `pointsWeight` flat at `1` for simple mini tournaments unless the published rules define different weights.
7. Set `podiumPick` to `null` unless the tournament explicitly supports a championship/podium pick.
8. Run `npm run check` and `npm run build` after code changes that consume the profile.

Never store API keys, private keys, mnemonics, or service role secrets in tournament profile files.
