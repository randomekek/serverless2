function hexToByteString(hex) {
  var bytes = [];
  for (var c = 0; c < hex.length; c += 2) {
    bytes.push(String.fromCharCode(parseInt(hex.substr(c, 2), 16)));
  }
  return bytes.join('');
}

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const randomChar = () => alphabet[Math.floor(alphabet.length * Math.random())];
function randomChars(length) {
  return Array.from({length}, randomChar).join('');
}

function mapRemove(map, key, value) {
  if (!map.has(key)) {
    throw 'could not find';
  }
  const result = map.get(key);
  map.delete(key);
  return result;
}

async function hashBin(binary) {
  // strings: Map compares buffers by reference, string keys are easier to read
  const hash = new Uint16Array(await crypto.subtle.digest('SHA-256', binary));
  const base = alphabet.length;
  const out = [];
  var current = 0;
  for (var i=0; i<hash.length; i++) {
    current = current * 65536 + hash[i];
    const octet = [];
    while (current >= base) {
      const remainder = current % base;
      octet.push(alphabet[remainder]);
      current = (current - remainder) / base;
    }
    out.push(octet);
  }
  out[out.length-1].push(alphabet[current]);
  return out.flatMap(x => x.reverse()).join('');
}

function randomId() {
  const base = alphabet.length;
  const out = [];
  let now = Math.floor(Date.now() / 1000);
  while (now > base) {
    const remainder = now % base;
    out.push(alphabet[remainder]);
    now = (now - remainder) / base
  }
  out.push(alphabet[now]);
  out.reverse();
  for (let i = 0; i < 6; i++) {
    out.push(alphabet[Math.floor(Math.random() * base)]);
  }
  return out.join('') + randomChars(6);
}

export {hexToByteString, randomChars, mapRemove, hashBin, randomId};
