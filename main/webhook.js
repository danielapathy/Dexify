const fs = require("node:fs");
const http = require("node:http");

const { safeJsonParse } = require("./utils");
const { getAppStateStoragePath } = require("./sessionStorage");

function startSessionWebhook({ getSession }) {
  const port = Number(process.env.SESSION_WEBHOOK_PORT || 3210);
  const token = process.env.SESSION_WEBHOOK_TOKEN || "";
  const exposeArl = process.env.SESSION_WEBHOOK_EXPOSE_ARL === "true";
  const exposeCookies = process.env.SESSION_WEBHOOK_EXPOSE_COOKIES === "true";

  const requireToken = (req, res) => {
    if (!token) return true;
    const provided = String(req.headers["x-webhook-token"] || "");
    if (provided && provided === token) return true;
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "forbidden" }));
    return false;
  };

  const server = http.createServer((req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad_request" }));
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");

      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/session") {
        if (!requireToken(req, res)) return;
        const session = getSession();
        const body = {
          ok: true,
          hasARL: Boolean(session?.arl),
          hasCookies: Boolean(session?.cookies && session.cookies.length > 0),
          cookieCount: session?.cookies?.length || 0,
          ...(exposeArl ? { arl: session?.arl || null } : {}),
          ...(exposeCookies ? { cookies: session?.cookies || [] } : {}),
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }

      if (url.pathname === "/app-state") {
        if (!requireToken(req, res)) return;
        try {
          const appStateRaw = fs.readFileSync(getAppStateStoragePath(), "utf8");
          const appState = safeJsonParse(appStateRaw);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, appState }));
        } catch (error) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "not_found" }));
        }
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "server_error", message: String(e) }));
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}

module.exports = { startSessionWebhook };

