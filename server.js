// Relay: formulario web -> cola -> Studio Lite (polling)
// Variables de entorno: OPENROUTER_API_KEY (para el modo IA), OPENROUTER_MODEL (opcional), KEY (opcional), PORT
const http = require("http");
const KEY = process.env.KEY || "0135128a77ff31c1513f";
const AI_KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.PORT || 3000;

const queue = [];
const results = [];
let nextId = 1;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => resolve(data));
  });
}

// Modelos gratis de OpenRouter, se prueban en orden hasta que uno responda
const MODELS = [
  process.env.OPENROUTER_MODEL,
  "cohere/north-mini-code:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openai/gpt-oss-120b:free",
].filter(Boolean);

async function askClaude(prompt) {
  const ctx = results.slice(-3).map((r) => `#${r.id} ok=${r.ok}: ${r.output}`).join("\n");
  const messages = [
    { role: "system", content: "Escribes codigo Luau para Roblox Studio Lite. Responde SOLO con codigo Luau ejecutable, sin explicaciones ni markdown." },
    { role: "user", content: (ctx ? `Resultados recientes:\n${ctx}\n\n` : "") + prompt },
  ];
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + AI_KEY },
        body: JSON.stringify({ model, messages, max_tokens: 4000 }),
      });
      const j = await r.json();
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (text) return text.replace(/^```(?:lua|luau)?\s*/i, "").replace(/```\s*$/, "").trim();
      lastErr = model + ": " + JSON.stringify(j).slice(0, 200);
    } catch (e) {
      lastErr = model + ": " + e.message;
    }
  }
  throw new Error("Ningun modelo respondio. " + lastErr);
}

const page = (msg = "") => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio Lite Relay</title>
<style>body{font-family:sans-serif;max-width:640px;margin:auto;padding:16px;background:#111;color:#eee}
textarea,input,select,button{width:100%;box-sizing:border-box;margin:6px 0;padding:10px;font-size:16px}
pre{background:#222;padding:8px;overflow:auto;white-space:pre-wrap}</style></head><body>
<h2>Studio Lite Relay</h2><p>${esc(msg)}</p>
<form method="POST" action="/send">
<input type="password" name="key" placeholder="Clave" required>
<select name="mode"><option value="lua">Enviar Luau directo</option>
<option value="ai"${AI_KEY ? "" : " disabled"}>Pedir a la IA${AI_KEY ? "" : " (falta OPENROUTER_API_KEY)"}</option></select>
<textarea name="text" rows="6" placeholder="Codigo Luau o lo que quieres que Claude haga" required></textarea>
<button>Enviar</button></form>
<h3>En cola: ${queue.length}</h3><h3>Ultimos resultados</h3>
${results.slice(-8).reverse().map((r) => `<pre>#${r.id} ok=${r.ok}\n${esc(r.output)}</pre>`).join("") || "<p>Nada aun</p>"}
</body></html>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, body, type = "text/html; charset=utf-8") => { res.writeHead(code, { "content-type": type }); res.end(body); };
  const authed = u.searchParams.get("key") === KEY;
  try {
    if (req.method === "GET" && u.pathname === "/") return send(200, page());
    if (req.method === "GET" && u.pathname === "/poll") {
      if (!authed) return send(401, "{}", "application/json");
      return send(200, JSON.stringify(queue.shift() || {}), "application/json");
    }
    if (req.method === "POST" && u.pathname === "/result") {
      if (!authed) return send(401, "{}", "application/json");
      const r = JSON.parse((await readBody(req)) || "{}");
      results.push({ id: r.id, ok: r.ok, output: String(r.output ?? "").slice(0, 2000) });
      if (results.length > 50) results.shift();
      return send(200, "{}", "application/json");
    }
    if (req.method === "POST" && u.pathname === "/send") {
      const f = new URLSearchParams(await readBody(req));
      if (f.get("key") !== KEY) return send(401, page("Clave incorrecta"));
      let code = f.get("text") || "";
      if (f.get("mode") === "ai" && AI_KEY) code = await askClaude(code);
      queue.push({ id: nextId++, code });
      return send(200, page("Enviado a la cola"));
    }
    send(404, "no");
  } catch (e) {
    send(500, page("Error: " + e.message));
  }
}).listen(PORT, () => console.log("Relay en puerto " + PORT));
