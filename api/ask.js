// The Lecture Hall — mini-lecture builder for curious adults
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL, CLAUDE_CHECK_MODEL (optional)

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const CHECK_MODEL = process.env.CLAUDE_CHECK_MODEL || "claude-haiku-5-5";
const HOURLY_LIMIT = 30;
const hits = new Map();

// Crisis language gets a caring answer and real help, never a lecture.
const HELP_WORDS = /\b(kill myself|suicide|suicidal|end my life|hurt myself|self harm|self-harm|want to die)\b/i;
const HELP = {
  type: "help",
  title: "You matter",
  answer: [
    { heading: "", text: "It sounds like you might be going through something really hard. You don't have to face it alone." },
    { heading: "", text: "In the US, you can call or text 988 to reach the Suicide and Crisis Lifeline any time, day or night. If you are in immediate danger, call 911. Talking to someone you trust can help too." }
  ]
};
const DECLINE = {
  type: "decline",
  title: "Let's pick another topic",
  answer: [{ heading: "", text: "That's not something the Lecture Hall can teach. Ask me about science, history, how things work, money, the body, nature, art, or almost anything else you're curious about." }]
};

const SYSTEM = `You are a brilliant, warm college professor giving a short, vivid mini-lecture to a curious adult. You explain on a large chalkboard, using a series of figures like lecture slides. You are an AI teaching assistant; if asked, say so honestly.

SCOPE: Any educational question: science, history, economics, money, technology, how things work, the human body and health basics, nature, space, art, music, language, philosophy, and more.

DECIDE THE TYPE FIRST:
- "lecture": an educational question. Teach it.
- "redirect": chit-chat or not a learning question. One or two friendly sentences steering to a related learning question.
- "decline": requests for instructions that could cause serious harm (weapons, hacking, making drugs, dangerous chemistry), sexual content, or harassment. Brief and polite.

CONTESTED TOPICS (politics, religion, current debates): explain the facts and the main viewpoints fairly. No personal opinions.
HEALTH, MONEY, LAW: teach how things work; do not give personal advice. Add one short line suggesting a professional for personal decisions when relevant.
ACCURACY: Well-established facts only. Say so when something is uncertain or debated.

THE MINI-LECTURE ("answer"): 300-450 words total, as 3-5 sections. Each section has a short "heading" and a "text" paragraph. Start with a section headed "The short answer". Then sections like "How it works", "A closer look", "Why it matters" (choose what fits). Plain, engaging prose; no markdown, no bullet lists, no emojis (it is read aloud).

THE CHALKBOARD ("board.figures"): 2-4 figures, shown one at a time like lecture slides. Each figure has a "title" (e.g. "Fig. 1: The water cycle"), a short "caption" (under 14 words), and an "svg".
Each svg is SVG ELEMENTS ONLY (no <svg> wrapper) on an 800 wide x 500 tall dark green chalkboard:
- Use single quotes for attribute values.
- Allowed elements: g, path, line, circle, ellipse, rect, polyline, polygon, text. Nothing else.
- Chalk colors only: #f5f3ea (white chalk), #ffe08a (yellow), #8ecbff (blue), #ffa3b1 (pink), #a8e6a3 (green), #ffc078 (orange). Mostly white and yellow. Fills, if any, use fill-opacity='0.25'.
- Lines: stroke-width 3 to 5, stroke-linecap='round'. Text: font-family='Kalam' font-size 20 to 34, fill a chalk color.
- Pick the right diagram type for each figure: labeled cross-section, flowchart, timeline, cycle, simple graph with labeled axes, comparison, cause-and-effect chain, or a formula worked step by step.
- LAYOUT: plan positions first. Objects must not overlap; text never sits on a shape; leave 20px between things; keep inside x 20-780, y 20-480. Max 18 elements per figure. Each figure stands alone (the board is cleared between figures).

OTHER FIELDS (lectures only):
- "terms": 2-4 key terms, each with a one-sentence definition.
- "surprising": one surprising, true fact (1-2 sentences).
- "misconception": one common misconception and the truth (1-2 sentences), or "".
- "image_query": 2-4 plain, literal search words for a real photo of what the topic looks like, or "" if a photo would not help.
- "deeper": exactly 3 smart follow-up questions.

For redirect, decline: fill only type, title, answer.

Always respond by calling the give_lecture tool.`;

const TOOL = {
  name: "give_lecture",
  description: "Deliver the mini-lecture.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["lecture", "redirect", "decline"] },
      title: { type: "string" },
      answer: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, text: { type: "string" } } } },
      board: { type: "object", properties: { figures: { type: "array", items: { type: "object", properties: { title: { type: "string" }, caption: { type: "string" }, svg: { type: "string" } } } } } },
      terms: { type: "array", items: { type: "object", properties: { word: { type: "string" }, meaning: { type: "string" } } } },
      surprising: { type: "string" },
      misconception: { type: "string" },
      image_query: { type: "string" },
      deeper: { type: "array", items: { type: "string" } }
    },
    required: ["type", "title", "answer"]
  }
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

function normalize(j) {
  if (!j || !Array.isArray(j.answer)) return null;
  j.answer = j.answer.map(a => typeof a === "string" ? { heading: "", text: a } : { heading: String(a.heading || ""), text: String(a.text || "") }).filter(a => a.text);
  return j.answer.length ? j : null;
}

async function getLecture(user) {
  const data = await anthropic({
    model: MODEL, max_tokens: 10000, system: SYSTEM,
    tools: [TOOL], tool_choice: { type: "auto" },
    messages: [{ role: "user", content: user }]
  });
  if (data.stop_reason === "max_tokens") throw new Error("too_long");
  const block = (data.content || []).find(b => b.type === "tool_use");
  let j = block ? normalize(block.input) : null;
  if (!j) {
    const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
    if (s >= 0 && e > s) j = normalize(JSON.parse(txt.slice(s, e + 1)));
  }
  if (!j) throw new Error("bad_shape");
  return j;
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "oops", reason: "K1" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= HOURLY_LIMIT) {
    return res.status(200).json({ type: "redirect", title: "Class dismissed (for now)", answer: [{ heading: "", text: "You've asked a lot of great questions this hour. Take a short break and come back soon for more." }] });
  }
  recent.push(now); hits.set(ip, recent);

  const body = req.body || {};
  const question = String(body.question || "").trim().slice(0, 300);
  const context = String(body.context || "").slice(0, 160);
  const more = body.more === true;
  const prev = String(body.prev || "").slice(0, 3000);
  if (!question) return res.status(400).json({ error: "empty" });
  if (HELP_WORDS.test(question)) return res.json(HELP);

  let user = `${context ? `We were just discussing: ${context}\n` : ""}Question: ${question}`;
  if (more) {
    user = `The learner tapped "Go deeper" on: ${context}\nHere is what you ALREADY covered:\n${prev}\n\nGive a NEW mini-lecture that goes one level deeper on this same topic: new mechanisms, history, numbers, or implications. New figures. Do not repeat what you already said. Title it like "Deeper: ...".`;
  }

  const start = Date.now();
  let lec = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !lec; attempt++) {
    if (attempt === 1 && Date.now() - start > 45000) break;
    try { lec = await getLecture(user); }
    catch (e) { lastErr = e; console.error("lecture attempt", attempt + 1, "failed:", e.message); }
  }
  if (!lec) {
    const m = String(lastErr && lastErr.message || "");
    const code = m.startsWith("api_429") ? "R2" : m.startsWith("api_5") ? "B3" : m === "too_long" ? "L4" : m.startsWith("api_4") ? "A5" : "S6";
    return res.status(500).json({ error: "oops", reason: code });
  }

  if (!["lecture", "redirect", "decline"].includes(lec.type)) lec.type = "lecture";
  if (lec.type === "decline") return res.json(DECLINE);

  try {
    if (lec.type === "lecture" && !(await safetyCheck(question, lec))) return res.json(DECLINE);
  } catch (e) {
    console.error("safety check failed:", e.message);
    return res.status(500).json({ error: "oops", reason: "C7" });
  }

  if (lec.board && Array.isArray(lec.board.figures)) {
    lec.board.figures = lec.board.figures.slice(0, 4).map(f => ({ title: String(f.title || ""), caption: String(f.caption || ""), svg: cleanSvg(f.svg) }));
  }
  return res.json(lec);
};
