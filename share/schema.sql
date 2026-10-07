-- The share Worker's one table: each short link's words, and the long link they stand for.
-- Applied once by hand, from the repo root:
--   npx wrangler d1 execute slowyourroll --remote -c share/wrangler.jsonc --file share/schema.sql
CREATE TABLE IF NOT EXISTS links (
  slug TEXT PRIMARY KEY,   -- "GreedyFelMurloc"
  query TEXT NOT NULL,     -- the long link's query string, as `shareUrl` writes it
  created INTEGER NOT NULL -- Unix milliseconds
);
