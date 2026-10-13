# Counting distinct clients of the index (2026-10-13)

The question: how many distinct clients run `ludion sync`? `ludion sync` downloads `/index/subjects.json` and one `/index/<subject>.json` per subject in the lockfile; the CLI sends no identifier of its own, only `User-Agent: ludion-ai/<version>` (0.1.4 and later). The Worker counts those requests into Analytics Engine. Why and how: `docs/decisions.md`, "Counting index requests".

**No results here yet.** Nothing is written until the Worker secret `ANALYTICS_SALT` is set (see below), and a weekly number needs a week of data. When there are numbers, they are written next to this file with the date and the command that produced them.

## What is stored

One data point per successful `GET` of a shard, as the Worker answers it:

| field | value |
| - | - |
| `index1` | the key: first 128 bits of HMAC-SHA-256, under the secret, of the UTC day, the client's IP address and its User-Agent |
| `blob1` | the UTC day, `YYYY-MM-DD` |
| `blob2` | the shard's path, e.g. `/index/vitest.json` (no query string) |
| `blob3` | `ludion-ai/<version>` when the User-Agent is exactly that, otherwise `other` |

The IP address, the User-Agent, and the secret are never written. The key changes every day (the day is in the HMAC input), so it can't be followed from one day to the next, and with the secret it can't be reversed by trying addresses, which would be easy for IPv4 without it.

## What the numbers mean, and don't

- A **client** is one (IP address, User-Agent) pair on one UTC day. Several people behind one office address with the same CLI version count once; one person whose address changes during the day (a phone, a VPN) counts more than once; CI runners that start on fresh addresses each run count once per run.
- A **week** is the sum of the days (client-days). Because the key is rotated, Ludion can't tell whether Monday's client is Tuesday's. A true weekly distinct count needs a key that lasts a week, which is a stronger kind of tracking; that choice is the owner's (the PR that added this says so).
- Browsers and tools other than the CLI (a person opening a shard, a crawler) land in `other`. Clients on `ludion-ai` 0.1.2 and earlier send no CLI User-Agent, so they are `other` too.
- Analytics Engine samples by index, and the index is the key, so a client's rows are thinned together and the distinct count of keys should not be thinned (Cloudflare's documentation says an exact count is possible when grouping by the index; not yet checked against data here). The request counts use `SUM(_sample_interval)`.

## Running it

`daily.sql` (distinct clients per day and CLI label) and `shards.sql` (requests per file per day) are the SQL; both look back seven days. `query.ts` runs both against the Analytics Engine SQL API and adds up the week:

```
CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token> node docs/bench/2026-10-13-index-counts/query.ts
```

The token needs "Account Analytics: Read" and stays in the environment. The same SQL can be pasted into the dashboard's Analytics Engine SQL page. `query.ts` was checked against a local stand-in for the API (the right path, the bearer token, the two SQL files sent as they are, the week summed), not against the real one: no data point existed when this was written.

## What the owner does to turn it on

1. `npx wrangler secret put ANALYTICS_SALT` and paste a random string of at least 32 characters, e.g. the output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Until then the Worker answers shards exactly as before and writes nothing.
2. If the first deploy after the merge says Analytics Engine must be enabled for the account, enable it in the Cloudflare dashboard (the message says where) and run the deploy again. The old version stays live meanwhile. Cloudflare's documentation, as found when this was written, doesn't say whether that step exists for this account.
