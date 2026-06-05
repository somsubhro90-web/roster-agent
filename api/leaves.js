export default async function handler(req, res) {
  const { kv } = await import('@vercel/kv');
  const leaves = await kv.get('leaves') || [];
  res.json({ leaves });
}
