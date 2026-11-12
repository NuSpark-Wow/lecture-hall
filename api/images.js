// Public domain / CC0 image finder
// Sources: Wikimedia Commons (license-filtered), Openverse (cc0 + public domain mark), NASA
// The search words always come from Mr. Paul (the lesson), never straight from the child.

const UA = "MrPaulsClassroom/1.0 (educational kids site)";
const BAD = /\b(nude|naked|nsfw|sex|erotic|corpse|dead body|gore|blood|weapon|gun|execution|war crime|torture|skull|drug)\b/i;
const strip = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

async function fromCommons(q) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=12&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap")
    + "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900";
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0]; const m = info?.extmetadata || {};
    const lic = (m.LicenseShortName?.value || "") + " " + (m.License?.value || "");
    if (!/public domain|\bpd\b|cc0|pdm/i.test(lic)) continue;
    const title = p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
    if (BAD.test(title) || BAD.test(m.ImageDescription?.value || "")) continue;
    return { src: info.thumburl || info.url, title: strip(title), credit: strip(m.Artist?.value) || "Unknown",
      license: /cc0/i.test(lic) ? "CC0" : "Public domain", source: "Wikimedia Commons", link: info.descriptionurl };
  }
  return null;
}

async function fromOpenverse(q) {
  const url = "https://api.openverse.org/v1/images/?license=cc0,pdm&mature=false&page_size=10&q=" + encodeURIComponent(q);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  for (const it of (await r.json()).results || []) {
    if (BAD.test(it.title || "") || it.mature) continue;
    return { src: it.thumbnail || it.url, title: strip(it.title), credit: strip(it.creator) || "Unknown",
      license: it.license === "cc0" ? "CC0" : "Public domain", source: "Openverse", link: it.foreign_landing_url };
  }
  return null;
}

async function fromNasa(q) {
  const r = await fetch("https://images-api.nasa.gov/search?media_type=image&q=" + encodeURIComponent(q));
  if (!r.ok) return null;
  for (const it of (await r.json()).collection?.items || []) {
    const d = it.data?.[0] || {}; const href = it.links?.[0]?.href;
    if (!href || BAD.test(d.title || "") || BAD.test(d.description || "")) continue;
    if (/©|copyright/i.test(d.description || "")) continue; // skip partner photos with copyright notes
    return { src: href, title: strip(d.title), credit: "NASA", license: "Public domain (NASA)", source: "NASA",
      link: "https://images.nasa.gov/details/" + encodeURIComponent(d.nasa_id || "") };
  }
  return null;
}

module.exports = async (req, res) => {
  if (!allowedRequest(req)) return blockRequest(res);
  const q = String(req.query.q || "").replace(/[^\w\s-]/g, " ").trim().slice(0, 60);
  if (!q || BAD.test(q)) return res.json({ image: null });
  const space = /\b(planet|moon|mars|saturn|jupiter|galaxy|star|nebula|rocket|astronaut|space|comet|asteroid|sun)\b/i.test(q);
  const order = space ? [fromNasa, fromCommons, fromOpenverse] : [fromCommons, fromOpenverse, fromNasa];
  for (const fn of order) {
    try { const img = await fn(q); if (img) { res.setHeader("Cache-Control", "s-maxage=86400"); return res.json({ image: img }); } } catch (e) {}
  }
  return res.json({ image: null });
};

// ---------- website lock ----------
// Only answer this tool's own pages and Paul's websites, so nobody else can run the tool on his credits.
// Add more sites in Vercel with an ALLOWED_SITES setting (comma separated); set LOCK_OFF to 1 to switch the lock off.
function allowedRequest(req) {
  if (String(process.env.LOCK_OFF || "") === "1") return true;
  const sites = ["nusparkpublishing.com", "nusparkmarketing.com", "nusparklearnwow.com"]
    .concat(String(process.env.ALLOWED_SITES || "").split(",").map(s => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean));
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase().split(":")[0];
  const ok = u => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === host || h === "localhost" || h === "127.0.0.1" || sites.some(d => h === d || h.endsWith("." + d));
    } catch (e) { return false; }
  };
  const origin = req.headers.origin, ref = req.headers.referer || req.headers.referrer;
  if (origin && origin !== "null") return ok(origin);
  if (ref) return ok(ref);
  return req.method === "GET"; // quick status checks; browsers always say where a POST comes from
}
function blockRequest(res) {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "not_allowed", message: "This tool only works on NuSpark websites." }));
}
