# Daily Event Manager with Login

This version saves events on a server and makes the agenda visible to every logged-in user.

## Run

Use the bundled Node.js runtime:

```powershell
& "C:\Users\uuptw\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\uuptw\Documents\Codex\2026-07-08\cr\outputs\online-event-manager\server.js"
```

Then open:

```text
http://localhost:3000
```

## Public hosting

The app is deployment-ready. See `DEPLOY.md` for Render hosting settings.

## Notes

- Register a user, then add events.
- Register or sign in as another user in a different browser/profile to see the same shared agenda.
- Users can see all events, but only the creator can edit, delete, or mark their own events done/open.
- Data is stored in `data/db.json` locally, or in `DATA_DIR/db.json` when the `DATA_DIR` environment variable is set.
- On Render, make sure the persistent disk mount path matches `DATA_DIR`.
- Passwords are hashed with Node's built-in `crypto.scryptSync`.
