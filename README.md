# pi-free-usage

A [pi coding agent](https://github.com/earendil-works/pi) extension that shows your **OpenRouter free-model daily usage** in the footer, plus weekly budget and spend details on demand.

## Features

- **Footer status** (`fusage`): remaining free requests for the current UTC day and the time until the daily reset, e.g. `free 504/1000 · 0h42m · $2.50 wk`.
- **Budget-aware**: if your key has a budget (`effective_budget`, e.g. a weekly workspace budget), the footer shows the remaining amount and turns warning-colored at ≤20% remaining. The free-count text turns warning-colored at ≤10% (or ≤5) remaining.
- **`/fusage` command**: full detail — free used/limit/remaining, time until 00:00 UTC reset, spend today/week/month, and **all budgets** in the `budgets` array (scope, reset interval, remaining, spent, reset date).
- Refreshes on session start, after each turn, every 60s, and on `/fusage`.

## Install

```bash
pi install git:github.com/herijooj/pi-free-usage
```

Then `/reload` or restart pi.

## Authentication

Uses your existing OpenRouter credentials — the same ones pi uses:

- `OPENROUTER_API_KEY` environment variable, or
- the `openrouter` entry in `~/.pi/agent/auth.json` (from `/login openrouter`; a plain string key, the OAuth `access` token, or a `key` field).

## Notes

- Reads `GET https://openrouter.ai/api/v1/key` — one request per refresh. No tokens are consumed beyond that.
- The daily counter resets at **00:00 UTC** (calendar day, not a rolling window). The reset countdown in the footer/command is computed locally as next UTC midnight.
- The `free_model_daily_requests` object comes straight from OpenRouter's key endpoint.
- If the response has no `free_model_daily_requests` (e.g. older account setup), `/fusage` reports the error and the footer shows `free ?`.

## License

MIT
