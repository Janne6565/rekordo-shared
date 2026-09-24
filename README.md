# rekordo-shared

Everything the Rekordo [web](https://github.com/Janne6565/rekordo-frontend)
and [mobile](https://github.com/Janne6565/rekordo-mobile) apps have to agree on
exactly, published as `@janne6565/rekordo-shared`.

Both apps are local-first: each device holds the whole collection and reconciles it with
the server field by field, last write wins, ordered by a hybrid logical clock. That only
works while the two clients compute identical answers. These files used to be hand-copied
between the repos under `MIRROR` headers, and drifted anyway — the two sync engines had
grown 196 lines apart by the time they were extracted.

## What belongs here

If the two apps computing it differently would make the same collection **converge
differently**, or store the same input as **different values**, it is shared:

| Area | Files |
| --- | --- |
| Domain shape | `domain/types.ts` |
| Clocks and merge | `domain/hlc.ts`, `domain/merge.ts` |
| Parsing typed input | `domain/money.ts`, `domain/passwordStrength.ts` |
| Which picture stands for a copy | `domain/preview.ts` |
| The stamped write path | `local/copyWrites.ts`, `local/photoWrites.ts`, `local/wishWrites.ts` |
| The storage contract | `local/LocalStore.ts` |
| Reconciliation | `sync/syncEngine.ts`, `sync/transport.ts` |
| When a sync pass runs | `sync/syncScheduler.ts`, `sync/useSyncLoop.ts`, `local/localWrites.ts` |
| Screen logic drawn two ways | `detail/theme.ts`, `detail/useCopyEditorLogic.ts` |

Rendering, storage engines and API clients are **not** shared. Dexie/IndexedDB on the web
and expo-sqlite on the device both implement `LocalStore`; each app implements
`SyncTransport` next to its own API client.

`domain/merge-fixture.json` is the hand-authored merge contract, asserted by this package's
suite *and* by the backend's Java suite. It is imported by consumers as
`@janne6565/rekordo-shared/merge-fixture.json`. Change it in both repos or a suite
fails — that is the point of it.

## Installing

GitHub Packages requires authentication even for public packages. Each consuming repo
carries an `.npmrc`:

```
@janne6565:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Locally, `export NODE_AUTH_TOKEN=$(gh auth token)`. In CI, `secrets.GITHUB_TOKEN` with
`packages: read`. Docker builds take it as a build secret rather than a build arg, so it
never lands in a layer.

## Releasing

Publishing is a tag: `npm version <patch|minor|major>` here, push the tag, and the publish
workflow builds and pushes to GitHub Packages. Then bump the dependency in whichever app
needs the change. A shared-code change is therefore three commits across three repos —
which is the cost of not being able to change one client's merge rules by accident.

## Developing

```
bun install
bun run test        # vitest, including the merge fixture and the sync engine
bun run typecheck
bun run build       # tsc → dist/, ESM + .d.ts
bun run lint
```

`testing/MemoryStore.ts` is a `LocalStore` in a `Map`, which is what lets the sync engine's
behaviour be tested here rather than against one app's storage engine. It is not exported
from the package entry point; it exists for this suite.
