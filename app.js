// ========= Simple Tenor GIF (Search / Trending / Infinite Scroll) =========
const API_KEY = window.TENOR_KEY;
const LIMIT = 24;
const ROOT_MARGIN_PX = 600;
const MAX_AUTO_FILL_PAGES = 3;


const $q        = document.querySelector(".q");
const $grid     = document.querySelector(".grid");
const $status   = document.querySelector(".status");
const $search   = document.querySelector(".search");
const $trending = document.querySelector(".trending");
const $sentinel = document.querySelector(".sentinel");


const state = {
  q: "",
  pos: "",
  mode: "trending", 
  loading: false,
  done: false,
  _bootstrapped: false
};

let io = null;

if (!API_KEY) console.warn("TENOR_KEY is missing. Set window.TENOR_KEY before app.js.");
const required = [$q, $grid, $status, $search, $trending, $sentinel];
if (required.some(el => !el)) {
  throw new Error("Missing required DOM elements (.q, .grid, .status, .search, .trending, .sentinel).");
}

// ===== Helpers =====
function setStatus(msg) { $status.textContent = msg || ""; }
function clearGrid() { $grid.innerHTML = ""; $grid.appendChild($sentinel); } 


function sentinelOnScreen() {
  const remaining = $grid.scrollHeight - $grid.scrollTop - $grid.clientHeight;
  return remaining <= ROOT_MARGIN_PX;
}

function appendGifs(items) {
  const frag = document.createDocumentFragment();
  for (const it of items) {
    if (!it.url || it.url.endsWith(".mp4")) continue;
    const img = new Image();
    img.loading = "lazy";
    img.decoding = "async";
    img.src = it.url;
    img.alt = it.title || "";
    frag.appendChild(img);
  }
  
  $grid.insertBefore(frag, $sentinel);
}

// ===== API =====
async function fetchGifs({ q, pos, mode }) {
  const base = mode === "search"
    ? "https://tenor.googleapis.com/v2/search"
    : "https://tenor.googleapis.com/v2/featured";

  const params = new URLSearchParams({ key: API_KEY, limit: String(LIMIT) });

  if (mode === "search") {
    const qq = (q || "").trim();
    if (!qq) return { gifs: [], next: "" };
    params.set("q", qq);
  }
  if (pos) params.set("pos", pos);

  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];

  return {
    gifs: results.map(g => ({
      url:
        g.media_formats?.tinygif?.url ||
        g.media_formats?.gif?.url ||
        g.media_formats?.nanogif?.url ||
        g.media_formats?.mediumgif?.url ||
        "",
      title: g.content_description || ""
    })),
    next: json.next || ""
  };
}

// ===== Load =====
async function load({ reset = false } = {}) {
  if (state.loading || state.done) return;

  if (reset) {
    state.pos = "";
    state.done = false;
    clearGrid();
    setStatus("Loading…");
  }

  state.loading = true;

  try {
    let pagesFetched = 0;

    do {
      const { gifs, next } = await fetchGifs(state);

      if (!gifs.length) {
        state.done = true;
        setStatus(state.mode === "search" ? "No results." : "No trending right now.");
        break;
      }

      appendGifs(gifs);
      state.pos = next;
      setStatus(next ? "" : "End of results.");
      if (!next) { state.done = true; break; }

      pagesFetched += 1;

      
      if (!(sentinelOnScreen() && pagesFetched < MAX_AUTO_FILL_PAGES)) {
        break;
      }
      await new Promise(requestAnimationFrame);
    } while (true);

  } catch (err) {
    console.error(err);
    setStatus("Fetch failed. Check your API key and connection.");
  } finally {
    state.loading = false;
  }
}


function startIO(){
  if (io) return;
  io = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) load(); },
    { root: $grid, rootMargin: `${ROOT_MARGIN_PX}px` } 
  );
  io.observe($sentinel);
}
function stopIO(){
  if (!io) return;
  io.disconnect();
  io = null;
}

// ===== UI events =====
$search.addEventListener("click", () => {
  state.q = $q.value.trim();
  state.mode = state.q ? "search" : "trending";
  load({ reset: true });
});

$trending.addEventListener("click", () => {
  $q.value = "";
  state.q = "";
  state.mode = "trending";
  load({ reset: true });
});

$q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $search.click();
});

// ===== Toggle panel =====
(function(){
  const $toggle = document.getElementById('gif-toggle');
  const $panel  = document.getElementById('gif-panel');

  function openPanel(){
    $panel.hidden = false;
    $panel.classList.remove('fly-out');
    void $panel.offsetWidth;
    $panel.classList.add('fly-in');
    $toggle.setAttribute('aria-expanded', 'true');

    if (!state._bootstrapped) {
      state._bootstrapped = true;
      load({ reset: true }); 
    }
    startIO();
  }

  function closePanel(){
    $panel.classList.remove('fly-in');
    $panel.classList.add('fly-out');
    $toggle.setAttribute('aria-expanded', 'false');

    stopIO();

    $panel.addEventListener('animationend', function onEnd(){
      $panel.hidden = true;
      $panel.removeEventListener('animationend', onEnd);
    }, { once: true });
  }

  $toggle.addEventListener('click', () => {
    if ($panel.hidden) openPanel(); else closePanel();
  });
})();


window.addEventListener("beforeunload", () => stopIO());


