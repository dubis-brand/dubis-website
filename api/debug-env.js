// TEMP DEBUG — delete after use
module.exports = async function handler(req, res) {
  const key = process.env.PRINTFUL_API_KEY || '';
  const sid = process.env.PRINTFUL_STORE_ID || '';
  res.json({
    key_prefix:  key.substring(0, 6) + '...',
    key_length:  key.length,
    store_id:    sid,
  });
};
