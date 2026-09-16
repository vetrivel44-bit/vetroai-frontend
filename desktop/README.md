# VetroAI Desktop Computer Control

Computer mode controls your **real** mouse, keyboard, and screen. A website on its
own can never do that — browsers block it for security, which is why every product
that does this (including ChatGPT's Operator and Claude's computer use) either ships
a small local app or runs a remote machine in the cloud. This is VetroAI's local app.

## Install (about 1 minute)

1. Download **`VetroAI-Setup-x.y.z.exe`** from the
   [latest release](https://github.com/vetrivel44-bit/vetroai-frontend/releases).
2. Double-click it. It installs for your user only, so there is no admin prompt and
   nothing to configure, then opens VetroAI automatically.
3. Go to **Computer mode** and click **Allow** when it asks for screen control.

That's it. No Node.js, no terminal, no build step.

Prefer not to install anything? Download **`VetroAI-Portable-x.y.z.exe`** from the same
release and just run it — it leaves nothing behind.

Windows may show a SmartScreen warning ("Windows protected your PC") because the app
isn't code-signed yet. Click **More info → Run anyway**, or use the portable build.

## Safety

- Control is off on every launch and must be approved each session.
- Windows shows an explicit confirmation dialog before enabling it.
- Press **Ctrl+Shift+X** at any time for an emergency stop.
- The agent never takes the final click on installers, admin/UAC prompts, payments,
  credentials, or sending messages — it stops and hands those to you.
- Renderer code has no direct Node.js access.
- Mouse coordinates, action frequency, keys, typing length, and scrolling are validated.
- External links open outside the privileged desktop window.

## Building it yourself (maintainers only)

Users should never need this — CI builds the installer on every `desktop-v*` tag
(`.github/workflows/desktop-release.yml`), and it can also be run manually from the
Actions tab.

```bash
npm --prefix desktop ci
npm --prefix desktop start       # run it locally
npm --prefix desktop run dist:win  # installer + portable build in desktop/dist
```

The production site reaches the bridge only inside this Electron wrapper, through
`window.vetroDesktop`.
