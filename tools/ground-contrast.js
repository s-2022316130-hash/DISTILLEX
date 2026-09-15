// Sample the COMPOSITED background of the app, in both themes, and report the
// worst contrast any text role would have against it.
//
//   node tools/ground-contrast.js
//
// Why this is not in tools/test.js: it needs a browser to paint the page.
// The suite reads tokens, and a background layer is exactly what reading
// tokens cannot see — two grids sharing a pitch composited four rules onto
// one pixel and dropped --dx-ink3 to 3.95:1, which no token check would
// have caught. Requires playwright.
const { chromium } = require('playwright');
const lum = ([r,g,b]) => { const f=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
  return .2126*f(r)+.7152*f(g)+.0722*f(b); };
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const INK = { light:{ink:[25,30,41],ink2:[79,87,103],ink3:[92,101,120]},
              dark: {ink:[241,243,248],ink2:[176,182,194],ink3:[144,152,169]} };
(async()=>{
 const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
 const dec = await b.newPage();
 for (const theme of ['light','dark']) {
  const p=await b.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
  await p.goto('file://'+require('path').resolve('index.html')); await p.waitForTimeout(1500);
  const isDark = await p.$eval('.dx', e=>e.className.includes('dx-dark'));
  if ((theme==='light')===isDark){ await p.evaluate(()=>{const x=[...document.querySelectorAll('button')]
    .find(e=>/^(Light|Dark) mode$/.test((e.textContent||'').trim())); if(x)x.click();}); await p.waitForTimeout(700);}
  await p.evaluate(()=>{const x=[...document.querySelectorAll('button[data-v="sim"]')].find(e=>e.offsetParent!==null);if(x)x.click()});
  await p.waitForTimeout(1200);
  const base = await p.evaluate(()=>getComputedStyle(document.querySelector('.dx-app')).backgroundColor
    .match(/\d+/g).slice(0,3).map(Number));
  // strip every painted thing except the ground layer
  await p.evaluate(()=>{ document.querySelectorAll('main, header, footer, .dx-toast')
    .forEach(e=>e.style.visibility='hidden'); });
  await p.waitForTimeout(250);
  // keep clear of the scrollbar gutter: Chromium paints it mid-grey and it
  // is not the ground
  const png = (await p.screenshot({clip:{x:0,y:0,width:1370,height:900}})).toString('base64');
  const px = await dec.evaluate(async (d)=>{
    const img = new Image(); img.src='data:image/png;base64,'+d;
    await img.decode();
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
    const D=g.getImageData(0,0,img.width,img.height).data, out=[];
    for(let y=0;y<img.height;y+=5) for(let x=0;x<img.width;x+=5){
      const o=(y*img.width+x)*4; out.push([D[o],D[o+1],D[o+2],x,y]); }
    return out;
  }, png);
  const L = px.map(q=>lum(q));
  const lo=Math.min(...L), hi=Math.max(...L), bl=lum(base);
  const worstIdx = theme==='light' ? L.indexOf(lo) : L.indexOf(hi);
  const worst = px[worstIdx];
  const I = INK[theme];
  // where do the extreme pixels actually live?
  const ext = px.map((q,i)=>({q,l:L[i]}))
    .sort((a,c)=> theme==='light' ? a.l-c.l : c.l-a.l).slice(0,6)
    .map(e=>'('+e.q[3]+','+e.q[4]+')='+e.l.toFixed(3));
  console.log('   extremes:', ext.join(' '));
  const sorted=[...L].sort((a,c)=>a-c);
  const pct = q => sorted[Math.min(sorted.length-1, Math.floor(q*sorted.length))];
  const struct = theme==='light' ? pct(0.001) : pct(0.999);   // the structural extreme, not a stray pixel
  const structPx = px[L.indexOf(struct)];
  const I2 = INK[theme];
  console.log('   structural worst rgb('+structPx.slice(0,3).join(',')+')',
    '| ink '+ratio(I2.ink,structPx).toFixed(2)+':1',
    ' ink2 '+ratio(I2.ink2,structPx).toFixed(2)+':1',
    ' ink3 '+ratio(I2.ink3,structPx).toFixed(2)+':1');
  const swing = ((theme==='light' ? (bl-lo)/bl : (hi-bl)/Math.max(bl,1e-6))*100);
  console.log(theme.padEnd(5),
    'n='+String(px.length).padStart(6),
    '| ground L', bl.toFixed(4),
    '| composited', lo.toFixed(4)+' .. '+hi.toFixed(4),
    '| worst rgb('+worst.slice(0,3).join(',')+') at '+worst[3]+','+worst[4],
    '| ink '+ratio(I.ink,worst).toFixed(2)+':1',
    ' ink2 '+ratio(I.ink2,worst).toFixed(2)+':1',
    ' ink3 '+ratio(I.ink3,worst).toFixed(2)+':1');
  await p.close();
 }
 await b.close();
})();
