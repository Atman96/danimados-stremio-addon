async function prueba() {

  const url = "https://danimados.cc/episodios/los-picapiedra-1x1/";

  const response = await fetch(url);
  const html = await response.text();

  console.log(html.includes("player-option-1"));
  console.log(html.includes("player-option-2"));
  console.log(html.includes("player-option-3"));
  console.log(html.includes("player-option-4"));

}

prueba();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const cheerio = require("cheerio");

const BASE_URL = "https://danimados.cc";
const CATALOG_URL = `${BASE_URL}/series/`;

const manifest = {
  id: "org.atman96.danimados",
  version: "2.0.0",
  name: "Danimados",
  description: "Series, temporadas y episodios de Danimados",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["danimados:"],
  catalogs: [
    {
      type: "series",
      id: "danimados-series",
      name: "Danimados - Series",
      extra: [
        { name: "search", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// Identificadores de series y episodios

function makeId(url) {
  return "danimados:" +
    Buffer.from(url).toString("base64url");
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

// Descargar una página de Danimados

async function getPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(
      `Danimados respondió ${response.status}: ${url}`
    );
  }

  return cheerio.load(await response.text());
}

// Extraer series del catálogo

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

    const image = link.find("img").first().length
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

    const poster =
      image.attr("data-src") ||
      image.attr("data-lazy-src") ||
      image.attr("src");

    results.set(url.href, {
      id: makeId(url.href),
      type: "series",
      name: title,
      poster: poster
        ? new URL(poster, BASE_URL).href
        : undefined,
      url: url.href
    });
  });

  return [...results.values()];
}

// Extraer episodios desde la ficha de una serie

function extractEpisodes($) {
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

    if (!url.pathname.startsWith("/episodios/")) {
      return;
    }

    // Identificar temporada y episodio:
    // los-picapiedra-1x1
    // los-picapiedra-2x5

    const match = url.pathname.match(
      /-(\d+)x(\d+)\/?$/i
    );

    if (!match) return;

    const season = Number(match[1]);
    const episode = Number(match[2]);

    let title = (
      link.attr("title") ||
      link.find("img").attr("alt") ||
      link.text()
    )
      .replace(/\s+/g, " ")
      .trim();

    if (
      !title ||
      title.length < 2 ||
      /ver episodio|reproducir|play/i.test(title)
    ) {
      title = `Episodio ${season}x${episode}`;
    }

    const id = makeId(url.href);

    results.set(url.href, {
      id,
      title,
      season,
      episode
    });
  });

  return [...results.values()].sort((a, b) => {
    if (a.season !== b.season) {
      return a.season - b.season;
    }

    return a.episode - b.episode;
  });
}

// Catálogo general

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
        item.name.toLowerCase().includes(
          search.toLowerCase()
        )
      );
    }

    console.log(
      `Catálogo: ${metas.length} series encontradas`
    );

    return { metas };
  } catch (error) {
    console.error("Error en catálogo:", error.message);
    return { metas: [] };
  }
});

// Ficha de serie y episodios

builder.defineMetaHandler(async ({ id }) => {
  try {
    const url = getUrl(id);

    if (
      !url.startsWith(BASE_URL + "/series/") ||
      url.startsWith(BASE_URL + "/series//")
    ) {
      return { meta: null };
    }

    const $ = await getPage(url);

    const name = (
      $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text()
    ).trim();

    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const rawPoster =
      $('meta[property="og:image"]').attr("content") ||
      $("article img").first().attr("src") ||
      "";

    const poster = rawPoster
      ? new URL(rawPoster, BASE_URL).href
      : undefined;

    // Obtener todos los episodios enlazados
    const videos = extractEpisodes($);

    console.log(
      `${name}: ${videos.length} episodios encontrados`
    );

    return {
      meta: {
        id,
        type: "series",
        name: name || "Serie de Danimados",
        poster,
        description,
        website: url,
        videos
      }
    };

  } catch (error) {
    console.error("Error en ficha:", error.message);
    return { meta: null };
  }
});

// Fuentes de reproducción.
// No se extraen reproductores externos ni se
// eluden restricciones de sus proveedores.

builder.defineStreamHandler(async ({ id }) => {
  console.log("Solicitud de fuente:", id);

  return {
    streams: []
  };
});

// Iniciar servidor

const PORT = Number(process.env.PORT) || 7000;

serveHTTP(builder.getInterface(), {
  port: PORT
});

console.log(
  `Danimados 2.0 funcionando en puerto ${PORT}`
);
    
