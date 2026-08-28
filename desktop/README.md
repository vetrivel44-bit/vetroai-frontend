# VetroAI Desktop Computer Control

This companion app is required for real mouse, keyboard, and screenshot control. A normal Cloudflare-hosted website cannot access these operating-system features.

## Windows setup

1. Install Node.js 22 or newer.
2. Open PowerShell in this `desktop` folder.
3. Run `npm install`.
4. Run `npm start` to test.
5. Run `npm run dist:win` to create the Windows installer in `desktop/dist`.

## Safety

- Control is disabled on every launch.
- Windows shows an explicit confirmation dialog before enabling it.
- Press **Ctrl+Shift+X** at any time for an emergency stop.
- Renderer code has no direct Node.js access.
- Mouse coordinates, action frequency, keys, typing length, and scrolling are validated.
- External links open outside the privileged desktop window.

The production site can access the bridge only inside this Electron wrapper through `window.vetroDesktop`.
