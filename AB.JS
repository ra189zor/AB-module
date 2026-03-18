const BASE = "https://streamingunity.buzz";

// Shared headers — mimic a real browser so the site does not block the request
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://streamingunity.buzz/en"
};

// ───────────────────────────────────────────────────────────
//  1. searchResults(query)
//     Returns: [ { title, image, href }, … ]
// ───────────────────────────────────────────────────────────
async function searchResults(query) {
  try {
    const url = `${BASE}/en/search?query=${encodeURIComponent(query)}`;
    const res  = await fetch(url, { headers: HEADERS });
    const html = await res.text();
    const results = [];

    const hrefRe  = /href="(\/en\/titles\/(\d+)-[^"]+)"/gi;
    const imgRe   = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+)"/gi;
    const titleRe = /<(?:h2|h3|p|span)[^>]*class="[^"]*(?:title|name|label)[^"]*"[^>]*>\s*([^<]{1,120})\s*<\//gi;

    const hrefs  = [...html.matchAll(hrefRe)];
    const imgs   = [...html.matchAll(imgRe)];
    const titles = [...html.matchAll(titleRe)];

    for (let i = 0; i < hrefs.length && i < 20; i++) {
      const href  = `${BASE}${hrefs[i][1]}`;
      const image = imgs[i]   ? imgs[i][1]   : "";
      const title = titles[i] ? titles[i][1].trim() : `Title ${hrefs[i][2]}`;

      if (results.find(r => r.href === href)) continue;
      results.push({ title, image, href });
    }

    return results;
  } catch (e) {
    console.error("searchResults:", e);
    return [];
  }
}

// ───────────────────────────────────────────────────────────
//  2. getDetails(href)
//     href  : https://streamingunity.buzz/en/titles/{id}-{slug}
//     Returns: { title, image, description, episodes: [ { number, title, href } ] }
// ───────────────────────────────────────────────────────────
async function getDetails(href) {
  try {
    const res  = await fetch(href, { headers: HEADERS });
    const html = await res.text();

    const titleMatch = html.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : "Unknown Title";

    const posterMatch =
      html.match(/<img[^>]+class="[^"]*poster[^"]*"[^>]+src="([^"]+)"/i) ||
      html.match(/<img[^>]+src="(https?:\/\/[^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const image = posterMatch
      ? (posterMatch[1].startsWith("http") ? posterMatch[1] : `${BASE}${posterMatch[1]}`)
      : "";

    const descMatch =
      html.match(/<p[^>]*class="[^"]*(?:description|overview|plot)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      html.match(/<div[^>]*class="[^"]*(?:description|overview|plot)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    const idMatch = href.match(/\/titles\/(\d+)/);
    const id = idMatch ? idMatch[1] : null;

    const episodeLinks = [...html.matchAll(/href="(\/en\/watch\/\d+[^"]*)"/gi)];

    if (episodeLinks.length > 1) {
      const seen = new Set();
      const episodes = [];
      let epNum = 1;

      for (const m of episodeLinks) {
        const epPath = m[1];
        if (seen.has(epPath)) continue;
        seen.add(epPath);

        const epNumMatch = epPath.match(/[?&]ep=(\d+)/i) || epPath.match(/episode[_-]?(\d+)/i);
        const num = epNumMatch ? parseInt(epNumMatch[1]) : epNum;

        episodes.push({
          number: num,
          title: `Episode ${num}`,
          href: `${BASE}${epPath}`
        });
        epNum++;
      }

      episodes.sort((a, b) => a.number - b.number);
      return { title, image, description, episodes };
    }

    return {
      title,
      image,
      description,
      episodes: [
        {
          number: 1,
          title: title,
          href: `${BASE}/en/watch/${id}`
        }
      ]
    };
  } catch (e) {
    console.error("getDetails:", e);
    return { title: "Error", image: "", description: "", episodes: [] };
  }
}

// ───────────────────────────────────────────────────────────
//  3. getStream(href)
//     href  : https://streamingunity.buzz/en/watch/{id}
//     Returns: [ { url, quality }, … ]
// ───────────────────────────────────────────────────────────
async function getStream(href) {
  try {
    const res  = await fetch(href, { headers: HEADERS });
    const html = await res.text();

    const streams = [];

    for (const m of html.matchAll(/["'](https?:\/\/[^"']+\.mp4(?:[^"']*))["']/gi)) {
      const url = m[1];
      if (!streams.find(s => s.url === url)) {
        const qMatch = url.match(/(\d{3,4}p)/i);
        streams.push({ url, quality: qMatch ? qMatch[1] : "1080p" });
      }
    }
    if (streams.length) return streams;

    for (const m of html.matchAll(/["'](https?:\/\/[^"']+\.m3u8(?:[^"']*))["']/gi)) {
      const url = m[1];
      if (!streams.find(s => s.url === url)) {
        streams.push({ url, quality: "1080p" });
      }
    }
    if (streams.length) return streams;

    for (const m of html.matchAll(/data-(?:src|file|url|video|stream)="([^"]+)"/gi)) {
      const val = m[1];
      if (val.match(/\.(mp4|m3u8)/i) || val.includes("stream")) {
        streams.push({ url: val.startsWith("http") ? val : `${BASE}${val}`, quality: "1080p" });
      }
    }
    if (streams.length) return streams;

    const srcMatch = html.match(/<source[^>]+src="([^"]+)"/i);
    if (srcMatch) {
      const url = srcMatch[1].startsWith("http") ? srcMatch[1] : `${BASE}${srcMatch[1]}`;
      return [{ url, quality: "1080p" }];
    }

    const iframeMatch = html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/i);
    if (iframeMatch) {
      return [{ url: iframeMatch[1], quality: "1080p" }];
    }

    console.error("getStream: no stream found at", href);
    return [];
  } catch (e) {
    console.error("getStream:", e);
    return [];
  }
}
