# Contributing to LobsterPot

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/jhammant/lobsterpot.git
cd lobsterpot
npm install
npm run build
```

## Running Locally

```bash
# Dev mode (uses tsx for hot reload)
npm run dev -- --help

# Build and run compiled version
npm run build
node dist/cli.js --help

# Run tests
npm test
```

## Project Structure

```text
src/
  cli.ts          — CLI entry point (commander)
  pot-manager.ts  — Core pot lifecycle (create, monitor, kill)
  router.ts       — Smart routing: local-first build + expensive review
  api.ts          — REST API for remote management
  progress.ts     — Structured progress tracking + reports
  types.ts        — Shared types and default agent configs
  index.ts        — Public API exports
dashboard/
  index.html      — Mobile-friendly dark-theme dashboard
```

## Making Changes

1. Fork the repo and create a branch (`feat/my-feature`, `fix/my-bug`)
2. Write or update tests for your changes
3. Run `npm test` and `npm run build` to verify
4. Submit a PR with a clear description

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add support for new agent type
fix: handle SSH timeout gracefully
docs: update example config
chore: bump dependencies
```

## Adding a New Agent

1. Add the agent type to `AgentType` in `src/types.ts`
2. Add a default config to `DEFAULT_AGENTS` in `src/types.ts`
3. Test it with `lobsterpot create -n test -m <machine> -r /tmp -a <agent> -t "hello world"`

## Code Style

- TypeScript strict mode
- No `any` types unless unavoidable (mark with `// eslint-disable-next-line` and explain)
- Prefer explicit error handling over silent failures

## Reporting Issues

Open an issue at https://github.com/jhammant/lobsterpot/issues with:
- What you expected
- What happened
- Steps to reproduce
- Node version (`node -v`)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
