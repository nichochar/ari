![Ari](public/ari-logo.svg)

A personal AI tutor for any subject. Build a learning path, work through lessons and exercises, and ask questions as you go. Use pen and paper with a document camera, upload photos, or type your answers. Ari offers hints, grades your work, and remembers what you are learning.

![Ari running on a laptop beside a document camera and handwritten maths and physics work](docs/images/setup.jpg)

My everyday setup: Ari, pen and paper, and an [IPEVO V4K USB document camera](https://www.amazon.com/dp/B079DLTG9F). It’s the camera I use and recommend for working on paper.

## Run locally

Already using Ari? See [upgrading an existing installation](CONTRIBUTING.md#local-data) to keep your configuration and learning history.

You need **Node.js 24+**, Git, and a **ChatGPT account with Codex access**. This is a single-user local app; macOS is tested. The built-in camera bridge is Mac-only, while browser cameras and photo uploads do not need it.

```sh
git clone https://github.com/nichochar/ari.git
cd ari
npm ci
npm install -g @openai/codex@0.163.0
codex -c 'cli_auth_credentials_store="file"' login
```

Complete **Sign in with ChatGPT** in your browser. Ari uses that local Codex login and your plan's Codex allowance—no API key needed. File-based login lets Ari reuse the session; never share `~/.codex/auth.json`. [Official sign-in instructions](https://learn.chatgpt.com/docs/auth).

```sh
cp .env.example .env
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Stop with Ctrl+C. Models are configurable in `.env`; your account must have access to the selected models. Ari reports unavailable models rather than silently switching. For a custom Codex installation, set `CODEX_BIN` to its executable path.

## Make it yours

1. Open **Talk with Ari** and describe what you want to learn, your starting level, and your goals. For example: “Teach me photography from scratch, in 20-minute sessions.”
2. Discuss the proposed outline, then choose **Create lesson** or **Create curriculum**. Separate interests get separate learning paths; later lessons are prepared as you reach them.
3. Use the **Study desk** to practise. Ask for hints or feedback, add pages for longer work, and grade when ready. Save a reflection to help Ari adapt.

New learners start with a brief conversation. Tell Ari how you like to learn; change those preferences in chat or in **Settings → Your tutor / About you**. A mathematics and physics course is included as an example—you can start a different subject immediately. A camera is optional; choose **Use browser camera** or upload photos. The optional Mac IPEVO V4K bridge needs `ffmpeg`.

Want to try onboarding without resetting your progress? Run `npm run onboarding` for a separate fresh learner on port 3002. Stop that preview with `PORT=3002 npm run stop`.

## Your data

Chats, progress, uploaded materials and submitted photos are saved **on your computer**, under `.local/`, which Git ignores. Personalization lives in `~/.ari/workspace/`: `TUTOR.md` defines teaching style, `USER.md` holds learner context, and `memories/` holds detailed notes. Ari reads the two core files each turn and retrieves other notes as needed. Edit and restore the core documents in Settings; browse memories there or ask Ari to revise them. Existing learner notes and reflections are imported automatically.

Live camera preview stays local; deliberately submitted work and relevant learning context are sent to OpenAI for tutoring. This is a single-user local app—keep it on localhost.

`npm run backup` saves learning data, native conversation history and personalization files, excluding credentials. Keep its SQLite file and companion directories together. `.env`, credentials, backups and personal learning data are not included in this repository.

Personalization backups also include a matching `.workspace` directory with `TUTOR.md`, `USER.md`, memories and the workspace identity marker. To restore, stop Ari and restore the SQLite file, its `.codex` companion when present, and its `.workspace` contents to their original locations. The workspace location is saved in the database; preserve its identity marker. If backup reports that notes differ from recorded revisions, open Settings to refresh those edits and retry.

For development: `npm run dev` (UI on port 5173), `npm test`, and `npm run build`. Technical notes: [contributing](CONTRIBUTING.md).

[MIT license](LICENSE).
