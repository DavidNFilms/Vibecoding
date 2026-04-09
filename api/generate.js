module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing GEMINI_API_KEY" }));
      return;
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
      res.end();
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, model, hasKey: true }));
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const readJsonBody = async () => {
      if (req.body && typeof req.body === "object") return req.body;
      if (typeof req.body === "string") return JSON.parse(req.body);

      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return {};
      return JSON.parse(raw);
    };

    const body = await readJsonBody();
    const image = typeof body.image === "string" ? body.image : "";
    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Body must include { image: dataUrl }" }));
      return;
    }

    const mimeType = match[1];
    const data = match[2];

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const prompt =
      "Roast this drawing in ONE short, playful sentence. Keep it PG-13. No slurs, no hate, no protected-class insults, no sexual content. Just a silly, generic art critique.";

    const geminiRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data } },
            ],
          },
        ],
        generationConfig: {
          temperature: 1.0,
          maxOutputTokens: 60,
        },
      }),
    });

    const geminiJson = await geminiRes.json().catch(() => null);

    if (!geminiRes.ok) {
      const apiMessage =
        (typeof geminiJson?.error?.message === "string" && geminiJson.error.message) ||
        (typeof geminiJson?.message === "string" && geminiJson.message) ||
        "";
      console.error("Gemini API error", {
        status: geminiRes.status,
        statusText: geminiRes.statusText,
        message: apiMessage,
        body: geminiJson,
      });

      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Gemini API error",
          message: apiMessage || `Upstream returned ${geminiRes.status}`,
          status: geminiRes.status,
          details: geminiJson || null,
        })
      );
      return;
    }

    const roast =
      geminiJson?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("").trim() || "";

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ roast: roast || "That drawing has the confidence of a masterpiece and the execution of a sneeze." }));
  } catch (err) {
    console.error("Server error", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server error", message: String(err?.message || err) }));
  }
};
