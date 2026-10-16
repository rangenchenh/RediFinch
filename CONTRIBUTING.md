# Contributing to RediFinch

Thanks for helping improve RediFinch. Bug reports, documentation fixes, and focused pull requests are welcome.

## Before you start

- Search existing issues to avoid duplicate reports.
- For a behavior change, describe the user problem and expected result in an issue first.
- Keep pull requests focused and explain any changes to provider requests, hotkeys, permissions, or local data storage.

## Development

Use Windows 10/11 x64 with Node.js 22 or newer. Run `npm ci`, then `npm run dev`. The marketing site is a separate Next.js project in `website/`; run `npm ci` there before editing it.

Before opening a pull request, run `npm run typecheck`, the tests relevant to your change, and `npm run smoke` when you change Electron or native integration. If you change the website, run `npm run typecheck` and `npm run build` in `website/`.

## Pull requests

Include a short summary, the behavior you tested, and any setup needed to reproduce it. Do not commit API keys, model weights, local settings, recordings, build output, or logs.
