# Security

Pixel Office is designed as a local read-only monitor for agent and session activity.

## Safe Defaults

- Binds to `127.0.0.1` by default.
- Does not write into OpenClaw state.
- Default privacy mode is `aliases`, which replaces real agent and session identifiers with stable aliases.
- Debug session feed is blocked while privacy mode is enabled.
- Runtime logs, layout overrides, temporary screenshots, `.env`, and `node_modules` are git-ignored.
- The checked-in demo screenshot is generated from `PIXEL_OFFICE_DEMO_MODE=1`, not live runtime data.

## Do Not Publicly Expose It

Pixel Office can display operational state, runtime metadata, and log snippets. Keep it on loopback unless you intentionally run it on a trusted private LAN.

Do not publish:

- `.env` files
- `logs/`
- screenshots containing real names, session keys, chats, or paths
- private OpenClaw state directories
- custom sprite assets you do not have rights to redistribute

## Expanded Local Mode

For a trusted local view with full identifiers, set:

```bash
PIXEL_OFFICE_PRIVACY_MODE=off npm start
```

Use that only on your own machine. Do not commit screenshots or copied output from expanded local mode.

## LAN Mode

LAN mode requires `PIXEL_OFFICE_AUTH_TOKEN`. The provided LAN launcher generates one and prints a URL containing the token. Treat that URL as private.
