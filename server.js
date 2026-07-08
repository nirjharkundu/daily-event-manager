const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const REQUESTED_DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const FALLBACK_DATA_DIR = path.join(ROOT, "data");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
let activeDataDir = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function findWritableDataDir() {
  const candidates = [
    REQUESTED_DATA_DIR,
    FALLBACK_DATA_DIR,
    path.join(require("os").tmpdir(), "daily-event-manager-data")
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch (error) {
      console.warn(`Cannot write to data directory ${candidate}: ${error.message}`);
    }
  }

  throw new Error("No writable data directory is available.");
}

function dbFile() {
  activeDataDir ||= findWritableDataDir();
  return path.join(activeDataDir, "db.json");
}

function ensureDb() {
  const file = dbFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ users: [], sessions: [], events: [] }, null, 2));
  }
  return file;
}

function readDb() {
  return JSON.parse(fs.readFileSync(ensureDb(), "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(ensureDb(), JSON.stringify(db, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(cookie => {
    const index = cookie.indexOf("=");
    return [
      decodeURIComponent(cookie.slice(0, index).trim()),
      decodeURIComponent(cookie.slice(index + 1).trim())
    ];
  }));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempted = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), attempted);
}

function cleanSessions(db) {
  const now = Date.now();
  db.sessions = db.sessions.filter(session => session.expiresAt > now);
}

function currentUser(req, db) {
  cleanSessions(db);
  const token = parseCookies(req).session;
  const session = db.sessions.find(item => item.token === token);
  if (!session) return null;
  return db.users.find(user => user.id === session.userId) || null;
}

function setSessionCookie(res, token) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function requireAuth(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "Please sign in first." });
    return null;
  }
  return user;
}

function canManageEvent(user, event) {
  return event.createdBy && event.createdBy.id === user.id;
}

function validateEvent(input) {
  const title = String(input.title || "").trim();
  const date = String(input.date || "").trim();
  const start = String(input.start || "").trim();
  const end = String(input.end || "").trim();
  const category = String(input.category || "Work").trim();
  const priority = String(input.priority || "Normal").trim();
  const notes = String(input.notes || "").trim();

  if (!title || title.length > 80) return "Event name must be 1 to 80 characters.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Date must be valid.";
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
    return "End time must be after start time.";
  }
  if (!["Work", "Personal", "Health", "Learning", "Errand"].includes(category)) return "Category is invalid.";
  if (!["Low", "Normal", "High"].includes(priority)) return "Priority is invalid.";
  if (notes.length > 240) return "Notes must be 240 characters or fewer.";
  return null;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, dataDir: activeDataDir || REQUESTED_DATA_DIR });
    }

    const db = readDb();

    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const displayName = String(body.displayName || body.username || "").trim();
      const password = String(body.password || "");

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return sendJson(res, 400, { error: "Use 3-24 lowercase letters, numbers, or underscores for username." });
      }
      if (displayName.length < 2 || displayName.length > 40) {
        return sendJson(res, 400, { error: "Display name must be 2-40 characters." });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { error: "Password must be at least 6 characters." });
      }
      if (db.users.some(user => user.username === username)) {
        return sendJson(res, 409, { error: "That username is already registered." });
      }

      const user = {
        id: crypto.randomUUID(),
        username,
        displayName,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      const token = crypto.randomBytes(32).toString("hex");
      db.users.push(user);
      db.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      writeDb(db);
      setSessionCookie(res, token);
      return sendJson(res, 201, { user: publicUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find(item => item.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: "Username or password is incorrect." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      cleanSessions(db);
      db.sessions.push({ token, userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      writeDb(db);
      setSessionCookie(res, token);
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(req).session;
      db.sessions = db.sessions.filter(session => session.token !== token);
      writeDb(db);
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const user = currentUser(req, db);
      writeDb(db);
      return sendJson(res, 200, { user: user ? publicUser(user) : null });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const date = url.searchParams.get("date");
      const month = url.searchParams.get("month");
      const events = db.events
        .filter(event => !date || event.date === date)
        .filter(event => !month || event.date.startsWith(`${month}-`))
        .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
      return sendJson(res, 200, { events });
    }

    if (req.method === "POST" && url.pathname === "/api/events") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const error = validateEvent(body);
      if (error) return sendJson(res, 400, { error });
      const event = {
        id: crypto.randomUUID(),
        title: body.title.trim(),
        date: body.date,
        start: body.start,
        end: body.end,
        category: body.category,
        priority: body.priority,
        notes: String(body.notes || "").trim(),
        done: false,
        createdBy: publicUser(user),
        updatedBy: publicUser(user),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.events.push(event);
      writeDb(db);
      return sendJson(res, 201, { event });
    }

    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (eventMatch && (req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH")) {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const event = db.events.find(item => item.id === eventMatch[1]);
      if (!event) return sendJson(res, 404, { error: "Event not found." });
      if (!canManageEvent(user, event)) {
        return sendJson(res, 403, { error: "Only the event creator can edit, delete, or mark this event." });
      }

      if (req.method === "DELETE") {
        db.events = db.events.filter(item => item.id !== event.id);
        writeDb(db);
        return sendJson(res, 200, { ok: true });
      }

      const body = await readBody(req);
      if (req.method === "PATCH") {
        event.done = Boolean(body.done);
      } else {
        const error = validateEvent(body);
        if (error) return sendJson(res, 400, { error });
        Object.assign(event, {
          title: body.title.trim(),
          date: body.date,
          start: body.start,
          end: body.end,
          category: body.category,
          priority: body.priority,
          notes: String(body.notes || "").trim()
        });
      }
      event.updatedBy = publicUser(user);
      event.updatedAt = new Date().toISOString();
      writeDb(db);
      return sendJson(res, 200, { event });
    }

    return sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Request failed." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
}).listen(PORT, () => {
  console.log(`Daily Event Manager running at http://localhost:${PORT}`);
});
