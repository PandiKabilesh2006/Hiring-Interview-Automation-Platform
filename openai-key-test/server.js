const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5050);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = {
  ...loadEnvFile(path.join(ROOT, "..", ".env.local")),
  ...process.env,
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

async function testOpenAI() {
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  const model = env.TEST_AI_MODEL || env.AI_MODEL || "gpt-4o";

  if (!apiKey) {
    return { ok: false, status: null, error: "No AI_API_KEY or OPENAI_API_KEY found." };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a tiny API smoke test." },
        { role: "user", content: "Reply with exactly: API key works" },
      ],
      max_tokens: 20,
      temperature: 0,
    }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    model,
    keyPrefix: `${apiKey.slice(0, 7)}...`,
    message: body.choices?.[0]?.message?.content || null,
    error: body.error || null,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
    return;
  }

  if (req.url === "/api/test-openai") {
    try {
      sendJson(res, 200, await testOpenAI());
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`OpenAI key test app running at http://localhost:${PORT}`);
});
