# Tests

This folder is reserved for future focused unit tests.

The current template smoke tests live in the CLI harness:

```sh
npm run telegram-private-smoke -- --format summary
npm run telegram-nl-smoke -- --text "show me the menu option" --format summary
```

The GitHub Actions workflow runs the private Telegram smoke harness on every push and pull request. That smoke suite is implemented in `src/cli.ts` so it can exercise parser routing, permission gates, local memory, transaction-plan safety, and friendly Telegram output without contacting Telegram.

Add future unit tests here when score models, EV math, cutoff logic, duplicate guards, or report rendering need isolated regression coverage.
