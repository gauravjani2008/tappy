const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const UIDS_KEY = 'tappy:uids';
function expensesKey(uid) { return 'tappy:expenses:' + uid; }

function getUid(req) {
  var uid = req.headers['x-tappy-uid'] || (req.query && req.query.uid);
  if (!uid || typeof uid !== 'string' || uid.length < 8 || uid.length > 100) return null;
  // keep it to safe characters only
  if (!/^[a-zA-Z0-9-_]+$/.test(uid)) return null;
  return uid;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tappy-Uid');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var uid = getUid(req);
  if (!uid) return res.status(400).json({ error: 'Missing or invalid device id (X-Tappy-Uid header)' });
  var KEY = expensesKey(uid);

  try {
    if (req.method === 'GET') {
      const all = await redis.hgetall(KEY);
      const list = all ? Object.values(all).map((v) => (typeof v === 'string' ? JSON.parse(v) : v)) : [];
      return res.status(200).json(list);
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      if (!body.id || typeof body.amount !== 'number') {
        return res.status(400).json({ error: 'Missing id or amount' });
      }
      await redis.hset(KEY, { [String(body.id)]: JSON.stringify(body) });
      await redis.sadd(UIDS_KEY, uid);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await redis.hdel(KEY, String(id));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
};
