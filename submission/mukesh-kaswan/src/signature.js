const crypto = require('node:crypto');

/** HMAC-SHA256 over the raw request body, hex encoded. */
function sign(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function isValidSignature(rawBody, signature, secret) {
  if (typeof signature !== 'string') return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = { sign, isValidSignature };
