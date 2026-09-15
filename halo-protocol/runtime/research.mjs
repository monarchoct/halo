import crypto from 'node:crypto';
import { safeFetch } from '../sdk/safe-fetch.mjs';

const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&#\d+;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
export const defaultSources = [
  { type: 'wordpress', url: 'https://www.nasa.gov/wp-json/wp/v2/posts?per_page=10&_fields=id,date_gmt,title,link,excerpt' },
  { type: 'github-releases', url: 'https://api.github.com/repos/NousResearch/hermes-agent/releases?per_page=5' },
];

/** Bounded, public source ingestion. Retrieved text is never interpreted as tool instructions. */
export async function collectEvidence({ store, sources = defaultSources, localOrigins = [], now = new Date(), maxAgeDays = 30 }) {
  const evidence = [], unavailable = [];
  for (const source of sources.slice(0, 5)) {
    try {
      const response = await safeFetch(source.url, { localOrigins });
      const data = JSON.parse(response.bytes);
      if (!Array.isArray(data) || data.length > 50) throw new Error('Unexpected research feed shape');
      const snapshot = await store.put({ version: 'halo.source.v1', url: source.url, retrievedAt: now.toISOString(), content: data });
      for (const item of data) {
        const title = plain(source.type === 'wordpress' ? item.title?.rendered : item.name);
        const summary = plain(source.type === 'wordpress' ? item.excerpt?.rendered : item.body);
        const publishedAt = source.type === 'wordpress' ? `${item.date_gmt}Z` : item.published_at;
        const url = source.type === 'wordpress' ? item.link : item.html_url;
        const date = new Date(publishedAt);
        if (!title || typeof url !== 'string' || url.length > 2048 || !Number.isFinite(+date) || +date > +now + 300000 || +now - +date > maxAgeDays * 86400000) continue;
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
        evidence.push({ id: crypto.createHash('sha256').update(url).digest('hex'), title: title.slice(0, 500), url,
          summary: summary.slice(0, 2000), publishedAt: date.toISOString(), retrievedAt: now.toISOString(), artifactURI: snapshot.uri });
      }
    } catch { unavailable.push({ url: source.url, error: 'Source or required artifact replicas unavailable' }); }
  }
  return { evidence: evidence.slice(0, 50), unavailable };
}
