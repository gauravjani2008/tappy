const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function settingsKey(uid) { return 'tappy:settings:' + uid; }

function getUid(req) {
  var uid = req.headers['x-tappy-uid'] || (req.query && req.query.uid);
  if (!uid || typeof uid !== 'string' || uid.length < 8 || uid.length > 100) return null;
  if (!/^[a-zA-Z0-9-_]+$/.test(uid)) return null;
  return uid;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tappy-Uid');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var uid = getUid(req);
  if (!uid) return res.status(400).json({ error: 'Missing or invalid device id (X-Tappy-Uid header)' });
  var KEY = settingsKey(uid);

  try {
    if (req.method === 'GET') {
      const raw = await redis.get(KEY);
      const settings = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      return res.status(200).json(settings);
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const existingRaw = await redis.get(KEY);
      const existing = existingRaw ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) : {};
      const merged = Object.assign({}, existing, body);
      await redis.set(KEY, JSON.stringify(merged));
      return res.status(200).json({ ok: true, settings: merged });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
};
