#!/usr/bin/env node
// test-webview-detection.cjs — regression guard for dubisIsFacebookWebView().
//
// 2026-08-19: the detection regex matched FB_IAB/FBAN/Instagram only. Meta's
// Android in-app browser stopped emitting those tokens, so for an unknown
// stretch the check returned false for 67% of live traffic (1,171 of 1,749
// page_views rows in the trailing 7 days) — including ALL 10 add-to-cart events
// and all 8 checkout attempts, every one of them US. Those shoppers got the
// normal PayPal buttons, whose popup silently dies inside a WebView. Result:
// 0 purchases, and nothing anywhere said so.
//
// The UAs in MUST_DETECT below are REAL rows copied out of page_views, not
// invented. Any future change to the detection must keep them passing.
//
//   node scripts/test-webview-detection.cjs     → exit 0 = pass
const fs = require('fs'); const vm = require('vm');
const src  = fs.readFileSync(require('path').join(__dirname,'..','js','main.js'),'utf8');
const snippet = src.slice(src.indexOf('window.dubisIsFacebookWebView = function()'),
                          src.indexOf('window.dubisIsInAppWebView'));
const sandbox = { window:{}, navigator:{ userAgent:'' } };
vm.createContext(sandbox);
vm.runInContext(snippet, sandbox);
const detect = (ua) => { sandbox.navigator.userAgent = ua; return sandbox.window.dubisIsFacebookWebView(); };

const MUST_DETECT = [
 ['DB: Celero3 checkout',   'Mozilla/5.0 (Linux; Android 14; Celero3 5G+ Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36'],
 ['DB: moto g 5G checkout', 'Mozilla/5.0 (Linux; Android 15; moto g 5G - 2024 Build/V1UFNS35H.193-20-14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36'],
 ['DB: moto g play x2',     'Mozilla/5.0 (Linux; Android 16; moto g play - 2026 Build/W1WNS36.18-111-3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.159 Mobile Safari/537.36'],
 ['DB: SKY B63',            'Mozilla/5.0 (Linux; Android 13; SKY B63 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36'],
 ['DB: SM-A176U',           'Mozilla/5.0 (Linux; Android 16; SM-A176U Build/BP4A.251205.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36'],
 ['legacy FB iOS',          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]'],
];
const MUST_NOT = [
 ['Chrome Android', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'],
 ['Safari iOS',     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
 ['Chrome iOS',     'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'],
 ['Chrome desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
 ['Safari macOS',   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'],
];
let pass = true;
console.log('--- MUST DETECT (real UAs that reached checkout) ---');
for (const [n,ua] of MUST_DETECT){ const r=detect(ua); if(!r)pass=false; console.log(`  ${r?'DETECTED':'MISS ❌  '}  ${n}`); }
console.log('--- MUST NOT DETECT (real browsers) ---');
for (const [n,ua] of MUST_NOT){ const r=detect(ua); if(r)pass=false; console.log(`  ${r?'FALSE POSITIVE ❌':'ok             '}  ${n}`); }
console.log(pass ? '\nRESULT: ALL PASS' : '\nRESULT: FAILURES');
process.exit(pass?0:1);
