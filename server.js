
const { addonBuilder, serveHTTP } = require ("stremio-addon-sdk");
const BASE_URL = "https://danimados.cc";
const CATALOG_URL = `${BASE_URL}/`;

const manifest = {
  id: "org.atman96.danimados",
  version: "1.0.0",
  name: "Danimados",
  description: "Catálogo de series animadas de Danimados",
  resources: ["catalog", "meta"],
  types: ["series"],
  idPrefixes: ["danimados:"],
  catalogs: [
    {
      type: "series",
      id: "danimados-series",
      name: "Danimados - Series",
      extra: [{ name: "search", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

function makeId(url) {
  return "danimados:" + Buffer.from(url).toString("base64url");
}

function getUrl(id) {
  try {
    return Buffer.from(
      id.replace("danimados:", ""),
      "base64url"
    ).toString("utf8");
  } catch {
    return "";
  }
}

async function getPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DanimadosAddon/1.0)"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Danimados respondió ${response.status}`);
  }

  return cheerio.load(await response.text());
}


function extractSeries($) {
  const results = new Map();

  $("a[href]").each((_, element) => {
    const link = $(element);
    const href = link.attr("href");

    if (!href) return;

    let url;

    try {
      url = new URL(href, BASE_URL);
    } catch {
      return;
    }

    if (url.hostname !== "danimados.cc") return;

    if (
      !url.pathname.startsWith("/series/") ||
      url.pathname === "/series/"
    ) return;

    const image =
      link.find("img").first().length
        ? link.find("img").first()
        : link.parent().find("img").first();

    const title = (
      link.attr("title") ||
      image.attr("alt") ||
      link.text()
    )
      .replace(/\s+/g, " ")
      .replace(/\bTV\b/gi, "")
      .trim();

    if (!title || title.length < 2) return;

    results.set(url.href, {
      id: makeId(url.href),
      type: "series",
      name: title,
      poster: image.attr("data-src") ||
              image.attr("data-lazy-src") ||
              image.attr("src") ||
              undefined,
      url: url.href
    });
  });

  return [...results.values()];
}

builder.defineCatalogHandler(async ({ extra = {} }) => {
  try {
    const search = (extra.search || "").trim();
    const target = search
      ? `${BASE_URL}/?s=${encodeURIComponent(search)}`
      : CATALOG_URL;

    const $ = await getPage(target);
    let metas = extractSeries($);

    if (!metas.length && search) {
      const fallback = await getPage(CATALOG_URL);
      metas = extractSeries(fallback).filter(item =>
        item.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    return { metas };
  } catch (error) {
    console.error("Error en catálogo:", error.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    const url = getUrl(id);

    if (!url.startsWith(BASE_URL + "/")) {
      return { meta: null };
    }

    const $ = await getPage(url);

    const name = (
      $("h1").first().text() ||
      $("title").text()
    ).trim();

    const description = $(
      'meta[name="description"]'
    ).attr("content") || "";

    const poster =
      $('meta[property="og:image"]').attr("content") ||
      $("article img").first().attr("src") ||
      "";

    return {
      meta: {
        id,
        type: "series",
        name: name || "Serie de Danimados",
        poster: poster ? new URL(poster, BASE_URL).href : undefined,
        description,
        website: url
      }
    };
  } catch (error) {
    console.error("Error en ficha:", error.message);
    return { meta: null };
  }
});

const PORT = Number(process.env.PORT) || 7000;

serveHTTP(builder.getInterface(), {
  port: PORT
});

console.log(`Danimados funcionando en puerto ${PORT}`);
