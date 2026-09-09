# Contributing

Thanks for your interest in contributing to `@thallesp/nestjs-restate`!

## Toolchain

> [!IMPORTANT]
> This repository is developed and tested with **[Bun](https://bun.com)**. The
> `bun.lock` file is the source of truth for dependencies. Please do **not** run
> `npm`, `yarn`, or `pnpm` against the repository.
>
> (The published package can still be installed with any package manager.)

Prerequisites:

- [Bun](https://bun.com/docs/installation) (the version used by CI is pinned in `package.json`)
- Node.js `>= 22.22.1`
- Docker, for the end-to-end tests (they start a Restate server with testcontainers)

## Getting started

```bash
bun install
bun run check
bun run build
bun run test
```

## Development commands

| Command | What it does |
| --- | --- |
| `bun run check` | Biome lint + format check, then `tsc --noEmit` |
| `bun run build` | Build `dist/` with unbuild |
| `bun run test` | Run the whole Vitest suite (unit, type-level and Docker e2e) |
| `bun run test:watch` | Vitest in watch mode |

## Pull requests

- Keep the public API small. This library wraps the Restate SDK, it does not replace it.
- Add or update tests in `tests/` for behaviour changes.
- Run `bun run check` and `bun run test` before opening the PR.
