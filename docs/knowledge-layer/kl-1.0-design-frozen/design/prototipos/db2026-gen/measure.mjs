import { createRequire } from "node:module"; const require=createRequire(import.meta.url);
const {chromium}=require("/opt/npm-tools/node_modules/playwright"); const fs=require('fs');
const b=await chromium.launch(); const p=await b.newPage();
for (const t of ['a','b']) { await p.setContent(fs.readFileSync(`r1-${t}/paged.html`,'utf8')); const h=await p.evaluate(()=>[...document.querySelectorAll('.tbl')].map(e=>e.getBoundingClientRect().height)); console.log(t,h); }
await b.close();
