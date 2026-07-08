# Public Deployment

This app is ready for public hosting on a Node.js web service.

## Recommended: Render

1. Create a GitHub repository.
2. Upload the files from this folder.
3. In Render, create a new Web Service from that repository.
4. Use these settings:

```text
Runtime: Node
Build command: npm install
Start command: npm start
Health check path: /api/health
Environment variable: NODE_ENV=production
Environment variable: DATA_DIR=/var/data
Persistent disk mount path: /var/data
```

The included `render.yaml` contains the same settings for Blueprint deployment.

## Important

- Public users can register themselves.
- Events are shared with every logged-in user.
- Passwords are hashed before storage.
- For serious production use, replace JSON file storage with PostgreSQL and add admin controls for user management.
