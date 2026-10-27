import {mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const snapshot=JSON.parse(readFileSync(new URL('data/latest.json',root),'utf8'));
if(snapshot.schemaVersion!==1 || !Array.isArray(snapshot.conferences) || snapshot.conferences.length===0)throw new Error('Invalid publication snapshot');
const out=new URL('_site/',root);mkdirSync(new URL('data/',out),{recursive:true});
for(const file of ['index.html','style.css','app.js','core.js','favicon.svg'])copyFileSync(new URL('dist/'+file,root),new URL(file,out));
// Embedded fallback and fetched JSON always describe the same published snapshot.
const safe=JSON.stringify(snapshot).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
writeFileSync(new URL('data.js',out),`window.PUBLISHED_SNAPSHOT=${safe};\nwindow.CONFERENCES=window.PUBLISHED_SNAPSHOT.conferences;\nwindow.DATA_UPDATED=${JSON.stringify(snapshot.seedDate)};\n`);
copyFileSync(new URL('data/latest.json',root),new URL('data/latest.json',out));
writeFileSync(new URL('.nojekyll',out),'');
console.log('Built GitHub Pages artifact: '+fileURLToPath(out));
