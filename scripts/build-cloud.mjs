import { mkdir, rm, copyFile } from 'node:fs/promises';
const out=new URL('../dist/',import.meta.url);
await rm(out,{recursive:true,force:true});
await mkdir(new URL('fonts/',out),{recursive:true});
for(const file of ['embed.html','embed.css','embed.mjs','cloud-embed.mjs','fonts/Figtree-Variable.woff2','fonts/Cabin-Variable.woff2','fonts/OFL-Figtree.txt','fonts/OFL-Cabin.txt']) {
  await copyFile(new URL(`../web/${file}`,import.meta.url),new URL(file,out));
}
