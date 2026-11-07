// The Lecture Hall — mini-lecture builder for curious adults (v2)
// v2: words and chalkboard figures are made at the same time (faster), repeat questions are
// saved on Vercel's network (instant + free), Quick vs Full depth, and mini-course outlines.
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL, CLAUDE_CHECK_MODEL (optional)

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const CHECK_MODEL = process.env.CLAUDE_CHECK_MODEL || "claude-haiku-5-5";
// The drawing step uses the faster model. To switch back, add BOARD_MODEL = claude-sonnet-5-5 in Vercel settings.
const BOARD_MODEL = process.env.BOARD_MODEL || "claude-haiku-5-5";
const HOURLY_LIMIT = 30;
const hits = new Map();

// Crisis language gets a caring answer and real help, never a lecture.
const HELP_WORDS = /\b(kill myself|suicide|suicidal|end my life|hurt myself|self harm|self-harm|want to die)\b/i;
const HELP = {
  type: "help", title: "You matter",
  answer: [
    { heading: "", text: "It sounds like you might be going through something really hard. You don't have to face it alone." },
    { heading: "", text: "In the US, you can call or text 988 to reach the Suicide and Crisis Lifeline any time, day or night. If you are in immediate danger, call 911. Talking to someone you trust can help too." }
  ]
};
const DECLINE = {
  type: "decline", title: "Let's pick another topic",
  answer: [{ heading: "", text: "That's not something the Lecture Hall can teach. Ask me about science, history, how things work, money, the body, nature, art, or almost anything else you're curious about." }]
};
const BREAK = {
  type: "redirect", title: "Class dismissed (for now)",
  answer: [{ heading: "", text: "You've asked a lot of great questions this hour. Take a short break and come back soon for more." }]
};

const DEPTH = {
  quick: `LENGTH: QUICK OVERVIEW. 120-180 words total, as 2 sections ("The short answer" and one more). The chalkboard gets 1-2 figures.`,
  full: `LENGTH: FULL LECTURE. 300-450 words total, as 3-5 sections. The chalkboard gets 2-4 figures.`
};

const SYSTEM_LECTURE = `You are a brilliant, warm college professor giving a short, vivid mini-lecture to a curious adult. You are an AI teaching assistant; if asked, say so honestly. (A separate artist draws the chalkboard figures; you write the words.)

SCOPE: Any educational question: science, history, economics, money, technology, how things work, the human body and health basics, nature, space, art, music, language, philosophy, and more.

DECIDE THE TYPE FIRST:
- "lecture": an educational question. Teach it.
- "redirect": chit-chat or not a learning question. One or two friendly sentences steering to a related learning question.
- "decline": requests for instructions that could cause serious harm (weapons, hacking, making drugs, dangerous chemistry), sexual content, or harassment. Brief and polite.

CONTESTED TOPICS (politics, religion, current debates): explain the facts and the main viewpoints fairly. No personal opinions.
HEALTH, MONEY, LAW: teach how things work; do not give personal advice. Add one short line suggesting a professional for personal decisions when relevant.
ACCURACY: Well-established facts only. Say so when something is uncertain or debated.

THE MINI-LECTURE ("answer"): sections, each with a short "heading" and a "text" paragraph. Start with a section headed "The short answer". Then sections like "How it works", "A closer look", "Why it matters" (choose what fits). Plain, engaging prose; no markdown, no bullet lists, no emojis (it is read aloud).

OTHER FIELDS (lectures only):
- "terms": 2-4 key terms, each with a one-sentence definition.
- "surprising": one surprising, true fact (1-2 sentences).
- "misconception": one common misconception and the truth (1-2 sentences), or "".
- "image_query": 2-4 plain, literal search words for a real photo of what the topic looks like, or "" if a photo would not help.
- "deeper": exactly 3 smart follow-up questions.

For redirect, decline: fill only type, title, answer.

Always respond by calling the give_lecture tool.`;

const SYSTEM_BOARD = `You are the chalkboard artist for a college professor. Given a learner's question, draw the figures the professor would put on the chalkboard while lecturing on it, like a series of lecture slides.

If the question is not a legitimate educational question (chit-chat, harmful instructions, sexual content), return figures: [].

Each figure has a "title" (e.g. "Fig. 1: The water cycle"), a short "caption" (under 14 words), an "svg", and a "legend".
LEGEND: list EVERY symbol, variable, Greek letter, math sign, and unit abbreviation that appears in that figure's svg (for example c, v, t, Δ, ≈, ×, ns, km/s, %, CO2), each with a plain-English meaning, and its value if it is a constant (for example "speed of light, about 300,000 km per second"). Use [] only if the figure has no symbols or abbreviations.
FORMULAS: for EVERY formula or equation written in that figure's svg (for example "distance = c × time error" or "E = mc²"), give the "formula" exactly as written and an "explanation": 1-2 plain-English sentences saying what it means and why it matters, as a great professor would say it out loud. Use [] if the figure has no formulas.
Each svg is SVG ELEMENTS ONLY (no <svg> wrapper) on an 800 wide x 500 tall dark green chalkboard:
- Use single quotes for attribute values.
- Allowed elements: g, path, line, circle, ellipse, rect, polyline, polygon, text. Nothing else.
- Chalk colors only: #f5f3ea (white chalk), #ffe08a (yellow), #8ecbff (blue), #ffa3b1 (pink), #a8e6a3 (green), #ffc078 (orange). Mostly white and yellow. Fills, if any, use fill-opacity='0.25'.
- Lines: stroke-width 3 to 5, stroke-linecap='round'. Text: font-family='Kalam' font-size 20 to 34, fill a chalk color.
- Pick the right diagram type for each figure: labeled cross-section, flowchart, timeline, cycle, simple graph with labeled axes, comparison, cause-and-effect chain, or a formula worked step by step.
- LAYOUT: plan positions first. Objects must not overlap; text never sits on a shape; leave 20px between things; keep inside x 20-780, y 20-480. Max 18 elements per figure. Each figure stands alone (the board is cleared between figures).

Always respond by calling the give_board tool.`;

const SYSTEM_OUTLINE = `You design short courses for curious adults. Given a topic, plan a 4-part mini-course that builds from basics to deeper ideas. Each part has a short "title" and a "question" the learner would ask to get that part's lecture. Give the course a clear "title". If the topic is harmful or not educational, return parts: []. Always respond by calling the give_outline tool.`;

// Live drawing: the artist writes one figure at a time in this plain format,
// and each finished figure is sent to the page right away.
const STREAM_FORMAT = `OUTPUT FORMAT (IMPORTANT): plain text only, no JSON, no tools. Write each figure as its own block, in order, exactly like this:
=== STEP
TITLE: Fig. 1: the figure title
CAPTION: the short caption
SVG: all of this figure's svg elements on ONE line
LEGEND: symbol | meaning ;; symbol | meaning
FORMULAS: formula | explanation ;; formula | explanation
=== END
Leave LEGEND or FORMULAS empty when there are none. Write nothing before the first block or after the last one. If the question is not appropriate, write only: === NONE`;
const SYSTEM_BOARD_STREAM = SYSTEM_BOARD.replace("Always respond by calling the give_board tool.", STREAM_FORMAT);

const LECTURE_TOOL = {
  name: "give_lecture", description: "Deliver the mini-lecture words.",
  input_schema: { type: "object", properties: {
    type: { type: "string", enum: ["lecture", "redirect", "decline"] },
    title: { type: "string" },
    answer: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, text: { type: "string" } } } },
    terms: { type: "array", items: { type: "object", properties: { word: { type: "string" }, meaning: { type: "string" } } } },
    surprising: { type: "string" }, misconception: { type: "string" }, image_query: { type: "string" },
    deeper: { type: "array", items: { type: "string" } }
  }, required: ["type", "title", "answer"] }
};
const BOARD_TOOL = {
  name: "give_board", description: "Deliver the chalkboard figures.",
  input_schema: { type: "object", properties: {
    figures: { type: "array", items: { type: "object", properties: { title: { type: "string" }, caption: { type: "string" }, svg: { type: "string" }, legend: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, meaning: { type: "string" } } } }, formulas: { type: "array", items: { type: "object", properties: { formula: { type: "string" }, explanation: { type: "string" } } } } } } }
  }, required: ["figures"] }
};
const OUTLINE_TOOL = {
  name: "give_outline", description: "Deliver the mini-course outline.",
  input_schema: { type: "object", properties: {
    title: { type: "string" },
    parts: { type: "array", items: { type: "object", properties: { title: { type: "string" }, question: { type: "string" } } } }
  }, required: ["title", "parts"] }
};

async function anthropic(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("api_" + r.status + " " + t.slice(0, 200)); }
  return r.json();
}

async function callTool(system, tool, user, maxTokens, check, model) {
  const data = await anthropic({
    model: model || MODEL, max_tokens: maxTokens, system,
    tools: [tool], tool_choice: { type: "auto" },
    messages: [{ role: "user", content: user }]
  });
  if (data.stop_reason === "max_tokens") throw new Error("too_long");
  const block = (data.content || []).find(b => b.type === "tool_use");
  if (block && block.input && check(block.input)) return block.input;
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
  if (s >= 0 && e > s) { const j = JSON.parse(txt.slice(s, e + 1)); if (check(j)) return j; }
  throw new Error("bad_shape");
}

async function streamClaude(system, user, maxTokens, model, onText) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, stream: true, messages: [{ role: "user", content: user }] })
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("api_" + r.status + " " + t.slice(0, 200)); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of ev.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let d; try { d = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta") onText(d.delta.text);
        if (d.type === "error") throw new Error("api_529 " + JSON.stringify(d.error || {}).slice(0, 120));
      }
    }
  }
}

function pairs(str, maxA, maxB, limit) {
  return String(str || "").split(";;").map(x => x.split("|")).filter(p => p.length >= 2)
    .map(p => [p[0].trim().slice(0, maxA), p.slice(1).join("|").trim().slice(0, maxB)]).filter(p => p[0] && p[1]).slice(0, limit);
}
function parseBlock(block) {
  const f = { TITLE: "", CAPTION: "", SVG: "", LEGEND: "", FORMULAS: "" }; let key = null;
  for (const raw of block.split("\n")) {
    const m = raw.match(/^\s*(TITLE|CAPTION|SVG|LEGEND|FORMULAS)\s*:\s*(.*)$/);
    if (m) { key = m[1]; f[key] = m[2]; }
    else if (key && raw.trim()) f[key] += " " + raw.trim();
  }
  return { title: f.TITLE.trim(), caption: f.CAPTION.trim(), svg: cleanSvg(f.SVG.trim()),
    legend: pairs(f.LEGEND, 20, 160, 10).map(([symbol, meaning]) => ({ symbol, meaning })),
    formulas: pairs(f.FORMULAS, 80, 400, 4).map(([formula, explanation]) => ({ formula, explanation })) };
}

// Streams drawing steps to the page as newline-separated JSON, one finished step per line.
async function streamBoard(res, isGet, user, maxSteps, kidsLimits) {
  let wrote = false, count = 0, text = "", lastErr = null, none = false;
  const start = () => {
    if (wrote) return; wrote = true;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", isGet ? "public, s-maxage=2592000, stale-while-revalidate=604800" : "no-store");
    res.setHeader("X-Accel-Buffering", "no");
  };
  const flush = () => {
    if (text.includes("=== NONE")) none = true;
    let a, b;
    while ((a = text.indexOf("=== STEP")) >= 0 && (b = text.indexOf("=== END", a)) >= 0) {
      const step = parseBlock(text.slice(a + 8, b)); text = text.slice(b + 7);
      if (!step.svg || count >= maxSteps) continue;
      if (kidsLimits) { step.legend = step.legend.slice(0, 8); step.formulas = step.formulas.slice(0, 3); delete step.title; }
      start(); res.write(JSON.stringify(step) + "\n"); count++;
    }
  };
  for (let attempt = 0; attempt < 2 && !wrote && !none; attempt++) {
    text = "";
    try { await streamClaude(SYSTEM_BOARD_STREAM, user, 8000, BOARD_MODEL, t => { text += t; flush(); }); flush(); lastErr = null; }
    catch (e) { lastErr = e; console.error("drawing attempt", attempt + 1, "failed:", e.message); }
    if (wrote || none) break;
  }
  if (wrote) { res.write(JSON.stringify({ done: true }) + "\n"); return res.end(); }
  if (none || !lastErr) {
    res.setHeader("Cache-Control", isGet && none ? "public, s-maxage=2592000" : "no-store");
    return res.status(200).json({ steps: [], done: true });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(500).json({ error: "oops", reason: errorCode(lastErr) });
}

async function withRetry(fn, budgetMs) {
  const start = Date.now(); let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1 && Date.now() - start > budgetMs) break;
    try { return await fn(); }
    catch (e) { lastErr = e; console.error("attempt", attempt + 1, "failed:", e.message); }
  }
  throw lastErr || new Error("failed");
}

function errorCode(err) {
  const m = String(err && err.message || "");
  return m.startsWith("api_429") ? "R2" : m.startsWith("api_5") ? "B3" : m === "too_long" ? "L4" : m.startsWith("api_4") ? "A5" : "S6";
}

function normalize(j) {
  if (!j || !Array.isArray(j.answer)) return null;
  j.answer = j.answer.map(a => typeof a === "string" ? { heading: "", text: a } : { heading: String(a.heading || ""), text: String(a.text || "") }).filter(a => a.text);
  return j.answer.length ? j : null;
}

// The page itself only allows safe drawing shapes; this is an extra first pass.
function cleanSvg(svg) {
  let s = String(svg || "");
  ["<script", "<style", "<image", "<foreignObject", "<iframe", "<use", "javascript:", "href="].forEach(bad => {
    s = s.split(bad).join("");
  });
  return s;
}

async function safetyCheck(question, lec) {
  const text = [lec.title, ...lec.answer.map(a => a.text), lec.surprising, lec.misconception, lec.image_query].join("\n");
  const data = await anthropic({
    model: CHECK_MODEL, max_tokens: 5,
    system: "You review content for a general-audience educational website for adults. Reply with exactly one word: SAFE or UNSAFE. UNSAFE only for sexual content, step-by-step instructions that could cause serious harm (weapons, drugs, hacking, dangerous chemistry), hate or harassment, or encouragement of self-harm. Normal education about history, war, medicine, the body, science, money, politics or religion explained neutrally is SAFE.",
    messages: [{ role: "user", content: `Question: ${question}\n\nContent:\n${text}` }]
  });
  const verdict = (data.content || []).map(b => b.text || "").join("");
  return /^\s*SAFE/i.test(verdict);
}

module.exports = async (req, res) => {
  const isGet = req.method === "GET";
  if (!isGet && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const send = (status, obj, cacheable) => {
    res.setHeader("Cache-Control", cacheable && isGet && status === 200 ? "public, s-maxage=2592000, stale-while-revalidate=604800" : "no-store");
    return res.status(status).json(obj);
  };
  if (!process.env.ANTHROPIC_API_KEY) return send(500, { error: "oops", reason: "K1" });

  const src = (isGet ? req.query : req.body) || {};
  const part = ["board", "outline"].includes(src.part) ? src.part : "lecture";
  const question = String(src.q || src.question || "").trim().slice(0, 300);
  const depth = src.depth === "quick" ? "quick" : "full";
  const context = isGet ? "" : String(src.context || "").slice(0, 200);
  const more = !isGet && src.more === true;
  const prev = isGet ? "" : String(src.prev || "").slice(0, 3000);
  if (!question) return send(400, { error: "empty" });

  if (HELP_WORDS.test(question)) {
    if (part === "board") return send(200, { figures: [] }, true);
    if (part === "outline") return send(200, { title: "", parts: [] }, true);
    return send(200, HELP, true);
  }

  // per-visitor limit counts lectures and course outlines (the figures ride along)
  if (part !== "board") {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
    if (recent.length >= HOURLY_LIMIT) return send(200, part === "outline" ? { title: "", parts: [], reason: "limit" } : BREAK, false);
    recent.push(now); hits.set(ip, recent);
  }

  if (part === "outline") {
    try {
      const o = await withRetry(() => callTool(SYSTEM_OUTLINE, OUTLINE_TOOL, `Topic: ${question}`, 1500, j => Array.isArray(j.parts)), 25000);
      const parts = o.parts.slice(0, 4).map(p => ({ title: String(p.title || ""), question: String(p.question || p.title || "") })).filter(p => p.question);
      return send(200, { title: String(o.title || question), parts }, true);
    } catch (e) {
      return send(500, { error: "oops", reason: errorCode(e) });
    }
  }

  let user = `${DEPTH[depth]}\n\n${context ? `We were just discussing: ${context}\n` : ""}Question: ${question}`;
  if (more) {
    user = `${DEPTH[depth]}\n\nThe learner tapped "Go deeper" on: ${context}\nHere is what was ALREADY covered:\n${prev}\n\nGo one level deeper on this same topic: new mechanisms, history, numbers, or implications. Do not repeat what was already said. Title it like "Deeper: ...".`;
  }

  if (part === "board") return streamBoard(res, isGet, user, 4, false);

  let lec;
  try {
    lec = await withRetry(async () => {
      const j = normalize(await callTool(SYSTEM_LECTURE, LECTURE_TOOL, user, 4000, x => Array.isArray(x.answer)));
      if (!j) throw new Error("bad_shape");
      return j;
    }, 30000);
  } catch (e) {
    return send(500, { error: "oops", reason: errorCode(e) });
  }

  if (!["lecture", "redirect", "decline"].includes(lec.type)) lec.type = "lecture";
  if (lec.type === "decline") return send(200, DECLINE, true);

  try {
    if (lec.type === "lecture" && !(await safetyCheck(question, lec))) return send(200, DECLINE, true);
  } catch (e) {
    console.error("safety check failed:", e.message);
    return send(500, { error: "oops", reason: "C7" });
  }
  return send(200, lec, true);
};
