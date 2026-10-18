# Contributing

Use Node.js 24+ and `npm ci`. `npm run dev` serves Vite on port 5173 and the API on port 3001. `npm test` uses isolated fixtures and needs no OpenAI credentials; `npm run build` typechecks and builds the app.

- `src/`: React UI; shared shadcn/Base UI controls in `src/components/ui/`, Graphite/Teal tokens in `src/theme.css`.
- `server/`: Express API, SQLite storage, Codex and optional Responses API adapters.
- `shared/`: types and the bundled example curriculum. New curricula are created in the app and stored locally.

## Local data

Never commit `.env`, `.local/`, Codex authentication/history, backups, uploads, or screenshots of real learner work. Use synthetic fixtures. Backups include the SQLite database and private native-history companion directory, but exclude authentication and diagnostics.

New installations use `.local/ari.sqlite`. When upgrading an older checkout, update the app-specific provider/path variables in `.env` to the `ARI_` prefix and set `ARI_DB_PATH` to your existing SQLite file before starting. Keep that file and its `.codex` companion in place so saved progress and native conversation history remain available. Browser navigation preferences now use `ari:` keys and reset once; learning data is unchanged.

The server binds to `127.0.0.1` and has no account authentication. Do not expose it as a public or shared service. A public GitHub repository does not make it a hosted app. External model calls receive relevant learning context and deliberately submitted work. Google Fonts supplies the UI fonts.

## Tutor connection

Codex CLI 0.163.0 is the tested version; its app-server protocol and feature flags are version-sensitive. Install that version and sign in with file-based credentials as described in the README. The subscription adapter requires a local `auth.json` managed by Codex; keychain-only login is not supported. A custom `CODEX_HOME` must contain that login; never commit it. `CODEX_BIN` can select a different executable. The main tutor has its own isolated native history and never imports unrelated Codex chats.

Models are explicit in `.env.example`. Change them to IDs available to your account when needed; provider/model errors never authorize a silent switch. Main-chat reasoning is high. API billing is opt-in: set the desired `ARI_AI_PROVIDER` / `ARI_MAIN_PROVIDER` to `openai`, supply `OPENAI_API_KEY`, and select `OPENAI_MODEL` / `OPENAI_MAIN_MODEL` in `.env`.

## Checking changes during a study session

Keep the live database and `dist/` untouched while someone is studying. Use `npm run build:preview`, then run an isolated instance:

```sh
PORT=3002 ARI_DB_PATH=.local/preview/state.sqlite ARI_LEGACY_PATH=.local/preview/legacy.json ARI_DIST_PATH=.local/preview-dist npm start
```

Coordinate any production restart. Camera/vision changes need real browser checks, including irrelevant and illegible work; never use a learner's real progress as test data.

## License

Contributions are under [MIT](LICENSE). Preserve the notices for adapted components and icons in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
