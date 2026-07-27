# Star History Chart

BookOrbit renders its README star-history chart in the repository instead of
depending on an external chart service.

## Storage

The `star-history` branch contains two generated files:

- `star-history.json`: validated daily aggregate counts and source metadata
- `star-history.svg`: the self-contained README chart

The workflow creates normal commits on this branch. It does not force-push, so
previous chart data remains recoverable without adding automated commits to
`main`.

The bootstrap snapshot at `scripts/star-history/bootstrap.json` contains the
initial exact aggregate history. It is used only when the publication branch
does not exist. Raw stargazer records and GitHub usernames are never stored.

## Refresh behavior

The `Star History` workflow runs daily and can also be dispatched manually.
It restores the stored series, obtains the current repository star count,
replaces any existing point for the current UTC date, renders the SVG, and
publishes the JSON and SVG in one branch commit.

The built-in workflow token is sufficient for daily snapshots. An optional
`STAR_HISTORY_TOKEN` repository secret belonging to a collaborator enables
exact-history refreshes from GitHub's timestamped stargazer endpoint. Exact
refreshes replace the aggregate curve and correct any drift from previous
snapshots. If the endpoint is unavailable, the workflow retains the stored
history and falls back to the current count.

The generator refuses malformed series, data for a different repository,
future points, invalid API responses, and exact histories beyond GitHub's
pagination limit. A failed run publishes nothing.

## Local commands

Run the focused test suite:

```bash
pnpm run test:star-history
```

Generate from a stored series and the current count:

```bash
GITHUB_TOKEN=... node scripts/star-history/generate.mjs \
  --repo bookorbit/bookorbit \
  --series star-history.json \
  --bootstrap scripts/star-history/bootstrap.json \
  --out star-history.svg
```

Set `STAR_HISTORY_TOKEN` as well to attempt a complete exact-history refresh.
