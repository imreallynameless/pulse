const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
export const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => encode(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function key(secret) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv}, await key(secret), encoder.encode(JSON.stringify(value)));
  return {iv:encode(iv),ciphertext:encode(ciphertext)};
}
export async function unseal(value, secret) {
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv)},await key(secret),decode(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
