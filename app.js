// ========= Simple Tenor GIF (Search / Trending / Infinite Scroll) =========
// API key comes from a global injected in index.html
const API_KEY = window.TENOR_KEY;

const LIMIT = 24;              // items per request
const ROOT_MARGIN_PX = 600;    // prefetch distance before the end

// UI elements
const $q        = document.querySelector(".q");          // search input
const $grid     = document.querySelector(".grid");       // image grid
const $status   = document.querySelector(".status");     // status text
const $trending = document.querySelector(".trending");   // show trending button
const $sentinel = document.querySelector(".sentinel");   // infinite scroll anchor
const $toggle   = document.querySelector(".gif-toggle"); // open/close button
const $panel    = document.querySelector(".gif-panel");  // panel container

// Ensure required DOM exists early
const required = [$q, $grid, $status, $trending, $sentinel, $toggle, $panel];
if (required.some(el => !el)) throw new Error("Missing required DOM elements.");

// Helpers

// Debounce: run fn after the user stops triggering it for `ms`
function debounce(fn, ms = 500) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Set status text (empty string hides it visually)
function setStatus(msg) { $status.textContent = msg || ""; }

// Reset the grid to an empty state but keep the sentinel at the end
function clearGrid() {
  $grid.innerHTML = "";
  $grid.appendChild($sentinel);
}

// Fallback check for when the sentinel is near the bottom (used by scroll fallback)
function sentinelOnScreen() {
  const remaining = $grid.scrollHeight - $grid.scrollTop - $grid.clientHeight;
  return remaining <= ROOT_MARGIN_PX;
}

// Append a batch of GIF <img>s before the sentinel to keep it last
function appendGifs(items) {
  const frag = document.createDocumentFragment();
  for (const it of items) {
    if (!it.url || it.url.endsWith(".mp4")) continue; // skip videos / bad entries
    const img = new Image();
    img.loading  = "lazy";
    img.decoding = "async";
    img.src = it.url;
    img.alt = it.title || "";
    frag.appendChild(img);
  }
  $grid.insertBefore(frag, $sentinel);
}

// --- State -----------------------------------------------------------------
const state = { q: "", pos: "", mode: "trending", loading: false, done: false };
let io = null;        // IntersectionObserver instance
let aborter = null;   // AbortController for in-flight fetches

// --- API -------------------------------------------------------------------
// Fetch a page of GIFs (search or trending) and normalize the response
async function fetchGifs({ q, pos, mode }) {
  if (aborter) aborter.abort();               // cancel previous request
  aborter = new AbortController();

  const base = mode === "search"
    ? "https://tenor.googleapis.com/v2/search"
    : "https://tenor.googleapis.com/v2/featured";

  const params = new URLSearchParams({ key: API_KEY, limit: String(LIMIT) });

  if (mode === "search") {
    const qq = (q || "").trim();
    if (!qq) return { gifs: [], next: "" };   // empty query => no call
    params.set("q", qq);
  }
  if (pos) params.set("pos", pos);            // pagination cursor

  const res = await fetch(`${base}?${params.toString()}`, { signal: aborter.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.data();
  const results = Array.isArray(data.results) ? data.results : [];

  return {
    gifs: results.map(g => ({
      url:
        g.media_formats?.tinygif?.url ||
        g.media_formats?.gif?.url ||
        g.media_formats?.nanogif?.url ||
        g.media_formats?.mediumgif?.url || "",
      title: g.content_description || ""
    })),
    next: data.next || ""
  };
}

// --- Loader 
// Load one page (respects state.loading/done). When reset=true, start fresh.
async function load({ reset = false } = {}) {
  if (state.loading || state.done) return;

  if (reset) {
    state.pos = "";
    state.done = false;
    clearGrid();
    setStatus("Loading…");
    if (!io && !$panel.classList.contains("hidden")) startIO();
  }

  state.loading = true;
  try {
    const { gifs, next } = await fetchGifs(state);

    if (!gifs.length) {
      state.done = true;
      setStatus(state.mode === "search" ? "No results." : "No trending right now.");
      return;
    }

    appendGifs(gifs);
    state.pos = next;

    if (!next) { state.done = true; setStatus("End of results."); }
    else       { setStatus(""); }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      setStatus("Fetch failed. Check your API key and connection.");
    }
  } finally {
    state.loading = false;
  }
}

// --- Infinite Scroll (IO + fallback) 
function startIO() {
  if (io) return;
  io = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) load(); },
    { root: $grid, rootMargin: `${ROOT_MARGIN_PX}px`, threshold: 0 }
  );
  io.observe($sentinel);

  // Fallback: also load via scroll if IO isn't enough on some browsers
  $grid.addEventListener("scroll", onGridScroll, { passive: true });
}

function stopIO() {
  if (io) { io.disconnect(); io = null; }
  $grid.removeEventListener("scroll", onGridScroll);
}

function onGridScroll() {
  if (state.loading || state.done) return;
  if (sentinelOnScreen()) load();
}

// --- UI wiring -------------------------------------------------------------
// Live search with debounce
$q.addEventListener("input", debounce(() => {
  state.q = $q.value.trim();
  state.mode = state.q ? "search" : "trending";
  load({ reset: true });
}, 500));

// Reset to trending
$trending.addEventListener("click", () => {
  $q.value = "";
  state.q = "";
  state.mode = "trending";
  load({ reset: true });
});

// Panel open/close + outside click + full cleanup on close
(function () {
  function openPanel() {
    $panel.classList.remove("hidden", "fly-out");
    $panel.classList.add("fly-in");
    document.body.classList.add("panel-open");
    startIO();
    load({ reset: true });
  }

  function closePanel() {
    $panel.classList.remove("fly-in");
    $panel.classList.add("fly-out");
    document.body.classList.remove("panel-open");
    stopIO();

    if (aborter) { aborter.abort(); aborter = null; }

    // Hide after animation, then fully reset UI/state
    $panel.addEventListener("animationend", function onEnd() {
      $panel.classList.add("hidden");
      $panel.removeEventListener("animationend", onEnd);

      $q.value = "";
      state.q = "";
      state.mode = "trending";
      state.pos = "";
      state.done = false;
      state.loading = false;
      clearGrid();
      setStatus("Start by searching or show trending GIFs.");
    }, { once: true });
  }

  // Toggle on button click
  $toggle.addEventListener("click", () => {
    $panel.classList.contains("hidden") ? openPanel() : closePanel();
  });

  // Click outside to close
  document.addEventListener("pointerdown", (e) => {
    if ($panel.classList.contains("hidden")) return;
    if (!$panel.contains(e.target) && !$toggle.contains(e.target)) closePanel();
  });
})();
