/**
 * The landing page's whole stylesheet (design/frenz-landing.html), inlined into the HTML. Small enough to inline
 * entirely (under the 15 KB compressed budget), so there is no stylesheet request in front of first paint.
 *
 * The design's tokens are kept exactly. The expensive effects are swapped for cheaper ones that look the same
 * (owner brief §4, performance first):
 *   · real backdrop blur ONLY on the header and the tab bar, at 16px, inside @supports — a solid surface otherwise
 *   · tool captions and the AI prompt: a semi-opaque solid tint, no backdrop-filter (they sit over static art)
 *   · sheets and the toast blur only while open; the dialog backdrop is a plain dim
 *   · no box-shadow / filter / gradient is ever animated: neumorphic press states switch instantly
 *   · cards get `contain: paint`; below-the-fold sections `content-visibility: auto` with an intrinsic size
 *   · the AI card's caret blinks a few times only while the card is on screen (core.js adds .run)
 *   · prefers-reduced-motion: no motion · prefers-reduced-transparency: solid glass · Save-Data: no decoration
 * Light mode is pure white (#FFFFFF): no wash, no grain, no fixed layer.
 */
export const LANDING_CSS = String.raw`
:root{color-scheme:light dark;
--ground:#FFFFFF;--ground-hi:#FFFFFF;--well:#F4F5F8;--ink:#101118;--sub:#4D5062;--muted:#5F6274;--hair:rgba(16,17,24,.07);
--b1:#3B5BFD;--b2:#7C3AED;--brand:linear-gradient(135deg,#3B5BFD 0%,#5B4BF3 50%,#8A3CEB 100%);--accent:#4F46E5;--accent-soft:rgba(79,70,229,.10);
--neu-out:0 1px 1px rgba(16,24,40,.04),0 12px 30px -8px rgba(16,24,40,.14),0 0 0 1px rgba(16,24,40,.05);
--neu-out-sm:0 1px 1px rgba(16,24,40,.04),0 6px 14px -4px rgba(16,24,40,.13),0 0 0 1px rgba(16,24,40,.05);
--neu-in:inset 0 2px 6px rgba(16,24,40,.09),inset 0 0 0 1px rgba(16,24,40,.05);
--neu-in-sm:inset 0 1px 4px rgba(16,24,40,.09),inset 0 0 0 1px rgba(16,24,40,.05);
--glass:rgba(255,255,255,.72);--glass-strong:rgba(255,255,255,.86);--glass-solid:#FFFFFF;--glass-line:rgba(16,24,40,.06);--blur:blur(16px) saturate(180%);
--ok:#16803C;--err:#B42318;--r-xl:30px;--r-lg:24px;--r-md:18px;
--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif;
--font-display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif;
--ease:cubic-bezier(.2,.8,.2,1);--spring:cubic-bezier(.34,1.56,.64,1)}
@media (prefers-color-scheme:dark){:root{--ground:#16181F;--ground-hi:#1C1F28;--well:#16181F;
--neu-out:-6px -6px 16px rgba(255,255,255,.045),9px 11px 26px rgba(0,0,0,.55);--neu-out-sm:-4px -4px 10px rgba(255,255,255,.045),5px 6px 14px rgba(0,0,0,.55);
--neu-in:inset 5px 5px 11px rgba(0,0,0,.55),inset -5px -5px 11px rgba(255,255,255,.045);--neu-in-sm:inset 3px 3px 6px rgba(0,0,0,.55),inset -3px -3px 6px rgba(255,255,255,.045);
--ink:#F2F3F7;--sub:#B3B6C4;--muted:#9A9DAE;--hair:rgba(255,255,255,.07);--accent:#8B85FF;--accent-soft:rgba(139,133,255,.14);
--glass:rgba(26,28,37,.58);--glass-strong:rgba(26,28,37,.84);--glass-solid:#1C1F28;--glass-line:rgba(255,255,255,.08);--ok:#4ADE80;--err:#F97066}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;min-height:100vh;font-family:var(--font);color:var(--ink);background:var(--ground);-webkit-font-smoothing:antialiased;position:relative}
@media (prefers-color-scheme:dark){body::before{content:"";position:absolute;left:0;right:0;top:0;height:640px;pointer-events:none;z-index:-1;
background:radial-gradient(900px 420px at 15% -120px,rgba(59,91,253,.14),transparent 70%),radial-gradient(700px 380px at 95% -80px,rgba(124,58,237,.12),transparent 70%)}}
a{color:inherit}button,input{font:inherit;color:inherit}button{cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2.5px solid var(--accent);outline-offset:3px;border-radius:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 20px}
.header{position:sticky;top:0;z-index:40;padding-top:env(safe-area-inset-top);background:var(--glass-solid);border-bottom:1px solid var(--hair)}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.header{background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}}
.header .wrap{height:64px;display:flex;align-items:center;gap:10px}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;margin-right:auto;min-height:44px}
.logo b{font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.4px}
.nav-links{display:none;gap:4px;margin-right:auto}
.nav-links a{padding:12px 14px;border-radius:12px;font-size:15px;font-weight:500;color:var(--sub);text-decoration:none}
.nav-links a:hover{color:var(--ink);background:var(--accent-soft)}
.btn-install{height:44px;padding:0 18px;border:0;border-radius:14px;background:var(--ink);color:var(--ground);font-size:15px;font-weight:650;letter-spacing:-.1px;
box-shadow:0 10px 22px -12px rgba(16,17,24,.6);transition:transform .15s var(--ease)}
.btn-install:active{transform:translateY(1px) scale(.98)}
.icon-btn{position:relative;width:44px;height:44px;flex:none;border:0;border-radius:14px;background:var(--ground);box-shadow:var(--neu-out-sm);display:flex;align-items:center;justify-content:center;color:var(--ink)}
.icon-btn:active,.icon-btn[aria-expanded="true"]{background:var(--well);box-shadow:var(--neu-in-sm)}
.icon-btn .dot{position:absolute;top:10px;right:10px;width:8px;height:8px;border-radius:50%;background:#E5484D;box-shadow:0 0 0 2px var(--ground)}
.hero{padding:34px 0 8px;display:grid;gap:28px}
.hero>*{min-width:0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 13px 0 10px;border-radius:999px;background:var(--ground);box-shadow:var(--neu-out-sm);font-size:13px;font-weight:600;color:var(--sub)}
.eyebrow i{width:7px;height:7px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 3px rgba(34,197,94,.18)}
h1{margin:18px 0 0;font-family:var(--font-display);font-weight:800;font-size:clamp(42px,11.6vw,72px);line-height:.98;letter-spacing:-.045em}
h1 .grad{background:var(--brand);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{margin:18px 0 0;font-size:clamp(17px,4.4vw,19px);line-height:1.5;color:var(--sub);max-width:34ch}
.lede strong{color:var(--ink);font-weight:650}
.dl{background:var(--ground);border-radius:var(--r-xl);padding:14px;box-shadow:var(--neu-out)}
.field{position:relative;display:flex;align-items:center;gap:10px;height:66px;padding:0 8px 0 18px;border-radius:22px;background:var(--well);box-shadow:var(--neu-in)}
.field.error{box-shadow:var(--neu-in),0 0 0 2px var(--err)}
.field svg{flex:none;color:var(--accent)}
.field input{flex:1;min-width:0;height:100%;border:0;background:transparent;outline:none;font-size:17px;letter-spacing:-.1px}
.field input::placeholder{color:var(--muted)}
.btn-paste{height:48px;padding:0 18px;border:0;border-radius:15px;flex:none;background:var(--ground);box-shadow:var(--neu-out-sm);color:var(--accent);font-size:16px;font-weight:650}
.btn-paste:active{background:var(--well);box-shadow:var(--neu-in-sm)}
.btn-clear{display:none;width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:var(--sub);align-items:center;justify-content:center;flex:none}
.btn-clear span{display:flex;width:32px;height:32px;border-radius:50%;background:var(--accent-soft);align-items:center;justify-content:center}
.field.has-value .btn-clear{display:flex}.field.has-value .btn-paste{display:none}
.helper{min-height:22px;margin:10px 6px 0;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px}
.helper.err{color:var(--err)}.helper.ok{color:var(--ok)}
.btn-dl{position:relative;width:100%;height:62px;margin-top:6px;border:0;border-radius:22px;overflow:hidden;background:var(--ink);color:var(--ground);font-size:18px;font-weight:700;letter-spacing:-.2px;
display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 14px 28px -14px rgba(16,17,24,.6);transition:transform .15s var(--ease)}
.btn-dl:active{transform:translateY(1px) scale(.992)}
.btn-dl[aria-busy="true"]{pointer-events:none}
.spinner{width:20px;height:20px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.works{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:16px 4px 4px;font-size:14px;color:var(--sub)}
.works span.p{font-weight:600;color:var(--ink)}.works .sep{color:var(--muted)}
.works button{border:0;background:none;padding:12px 6px;margin:-12px -6px;color:var(--accent);font-weight:650;border-radius:8px}
.works .p[data-on="true"]{color:var(--accent)}
.result{display:none;margin-top:14px;padding:14px;border-radius:22px;background:var(--well);box-shadow:var(--neu-in)}
.result.show{display:block;animation:rise .4s var(--spring) both}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.media{display:flex;gap:14px;align-items:center}
.thumb{position:relative;width:64px;height:84px;flex:none;border-radius:14px;overflow:hidden;background:linear-gradient(160deg,#1E1B4B 0%,#4338CA 45%,#C026D3 100%);box-shadow:0 6px 14px rgba(30,27,75,.3)}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.thumb svg{position:absolute;inset:0;margin:auto}
.media h3{margin:0;font-size:16px;font-weight:700;letter-spacing:-.2px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.media p{margin:3px 0 0;font-size:13px;color:var(--sub)}
.qualities{display:grid;gap:8px;margin:14px 0 0;border:0;padding:0}
.q{position:relative;display:flex;align-items:center;gap:12px;min-height:52px;padding:0 14px;border-radius:16px;background:var(--ground);box-shadow:var(--neu-out-sm);cursor:pointer}
.q input{position:absolute;opacity:0;pointer-events:none}
.q .radio{width:20px;height:20px;border-radius:50%;background:var(--well);box-shadow:var(--neu-in-sm);flex:none;display:flex;align-items:center;justify-content:center}
.q .radio::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--brand);transform:scale(0);transition:transform .25s var(--spring)}
.q:has(input:checked){background:var(--well);box-shadow:var(--neu-in-sm),0 0 0 1.5px var(--accent)}
.q:has(input:checked) .radio::after{transform:scale(1)}
.q:has(input:focus-visible){outline:2.5px solid var(--accent);outline-offset:2px}
.q b{font-size:15px;font-weight:650}.q span.meta{margin-left:auto;font-size:13px;color:var(--muted)}
.btn-save{width:100%;height:54px;margin-top:12px;border:0;border-radius:18px;background:var(--ink);color:var(--ground);font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 22px rgba(16,17,24,.22);transition:transform .15s var(--ease)}
.btn-save:active{transform:scale(.99)}
.btn-save[aria-busy="true"]{pointer-events:none;opacity:.8}
.btn-save .spinner,.btn-dl .spinner{border-color:rgba(127,127,140,.35);border-top-color:currentColor}
.more-link{display:block;margin-top:10px;text-align:center;font-size:14px;font-weight:600;color:var(--accent);text-decoration:none;padding:12px}
.shake{animation:shake .32s var(--ease)}
@keyframes shake{20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}
.row-card{display:flex;align-items:center;gap:14px;margin-top:18px;padding:14px 16px 14px 14px;border-radius:var(--r-lg);background:var(--ground);box-shadow:var(--neu-out);text-decoration:none;contain:paint}
.row-card:active{background:var(--well);box-shadow:var(--neu-in)}
.tile-ic{width:52px;height:52px;flex:none;border-radius:16px;background:var(--well);box-shadow:var(--neu-in-sm);display:flex;align-items:center;justify-content:center;color:var(--accent)}
.row-card .t{display:block;font-size:17px;font-weight:700;letter-spacing:-.2px}.row-card .s{display:block;font-size:14px;color:var(--sub);margin-top:2px}
.pro{height:28px;padding:0 11px;border-radius:999px;background:var(--brand);color:#fff;font-size:12px;font-weight:800;letter-spacing:.6px;display:inline-flex;align-items:center;box-shadow:0 4px 10px rgba(79,70,229,.3)}
section{padding-top:44px}
.below{content-visibility:auto;contain-intrinsic-size:auto 520px}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px}
.sec-head h2{margin:0;font-family:var(--font-display);font-size:26px;font-weight:800;letter-spacing:-.6px}
.sec-head a{font-size:15px;font-weight:600;color:var(--accent);text-decoration:none;padding:12px 0}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;counter-reset:s}
.step{padding:16px 14px;border-radius:var(--r-md);background:var(--ground);box-shadow:var(--neu-out-sm);contain:paint}
.step::before{counter-increment:s;content:counter(s);width:30px;height:30px;border-radius:10px;background:var(--well);box-shadow:var(--neu-in-sm);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--accent)}
.step b{display:block;margin-top:12px;font-size:15px;letter-spacing:-.1px}.step span{display:block;margin-top:3px;font-size:13px;line-height:1.4;color:var(--sub)}
.bento{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.tool{position:relative;display:block;min-height:196px;border-radius:var(--r-lg);overflow:hidden;text-decoration:none;color:#fff;box-shadow:var(--neu-out);isolation:isolate;contain:paint;transition:transform .25s var(--ease)}
.tool:active{transform:scale(.985)}
.tool.wide{grid-column:span 2;min-height:216px}
.tool .art{position:absolute;inset:0;z-index:-1}
.cap{position:absolute;left:10px;right:10px;bottom:10px;padding:12px 14px;border-radius:18px;background:rgba(18,16,40,.58);border:1px solid rgba(255,255,255,.18)}
.cap b{display:flex;align-items:center;justify-content:space-between;font-size:18px;font-weight:750;letter-spacing:-.3px}
.cap span{display:block;margin-top:2px;font-size:13px;line-height:1.35;color:rgba(255,255,255,.9)}
.tag{display:inline-flex;height:22px;padding:0 8px;border-radius:999px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);font-size:11px;font-weight:700;letter-spacing:.4px;align-items:center}
.art-ai{background:radial-gradient(120% 90% at 85% 10%,#C026D3 0%,transparent 55%),radial-gradient(90% 90% at 10% 100%,#3B5BFD 0%,transparent 60%),linear-gradient(160deg,#1A1046,#2E1A78)}
.art-ai::before{content:"";position:absolute;left:-20%;right:-20%;bottom:-10%;height:70%;background-image:linear-gradient(rgba(255,255,255,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.14) 1px,transparent 1px);
background-size:34px 34px;transform:perspective(380px) rotateX(58deg);transform-origin:bottom;-webkit-mask-image:linear-gradient(0deg,#000 10%,transparent 90%);mask-image:linear-gradient(0deg,#000 10%,transparent 90%)}
.prompt{position:absolute;top:18px;left:16px;right:16px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);font-size:14px;color:rgba(255,255,255,.95)}
.prompt .caret{display:inline-block;width:2px;height:16px;background:#fff;margin-left:1px;vertical-align:-3px}
.run .prompt .caret{animation:blink 1s steps(1) 8}
@keyframes blink{50%{opacity:0}}
.prompt .go{margin-left:auto;width:28px;height:28px;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.art-wp{background:linear-gradient(170deg,#0B1530 0%,#1C2C5A 60%,#3B4C80 100%)}
.fan{position:absolute;top:18px;left:50%;width:62px;height:112px;margin-left:-31px;border-radius:12px;border:2px solid rgba(255,255,255,.75);box-shadow:0 12px 24px rgba(0,0,0,.35)}
.fan.a{transform:translateX(-38px) rotate(-14deg);background:linear-gradient(180deg,#FDE68A,#F59E0B 55%,#9A3412)}
.fan.b{transform:translateX(38px) rotate(14deg);background:linear-gradient(180deg,#A5F3FC,#3B82F6 60%,#1E3A8A)}
.fan.c{z-index:1;background:radial-gradient(circle at 70% 26%,#FFF7D6 0 7px,transparent 8px),linear-gradient(180deg,#1E1B4B 0%,#4C1D95 55%,#0F172A 56%,#1E293B 100%)}
.art-earn{background:radial-gradient(90% 80% at 80% 0%,#FBBF24 0%,transparent 60%),linear-gradient(160deg,#3A2410,#7A4A12)}
.coins{position:absolute;top:22px;right:18px;width:96px;height:96px}
.coins i{position:absolute;left:0;right:0;height:22px;border-radius:50%;background:linear-gradient(180deg,#FFE58A,#F2A818);box-shadow:inset 0 -4px 0 #C97A06,0 4px 8px rgba(0,0,0,.25)}
.art-ex{background:linear-gradient(160deg,#2A1360,#6D28D9 60%,#DB2777)}
.art-ex .blurimg{position:absolute;top:16px;left:16px;right:16px;height:96px;border-radius:14px;background:radial-gradient(circle at 30% 40%,#F9A8D4,transparent 55%),radial-gradient(circle at 70% 60%,#A5B4FC,transparent 55%),#7C3AED;opacity:.9}
.art-ex .lock{position:absolute;top:44px;left:50%;margin-left:-22px;width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.26);border:1px solid rgba(255,255,255,.4);display:flex;align-items:center;justify-content:center}
.art-xp{background:#0F172A}
.art-xp .mosaic{position:absolute;inset:12px 12px 72px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:6px}
.art-xp .mosaic i{border-radius:9px}
.creator{display:grid;gap:18px;padding:22px;border-radius:var(--r-xl);background:var(--ground);box-shadow:var(--neu-out);contain:paint}
.creator h3{margin:0;font-family:var(--font-display);font-size:24px;font-weight:800;letter-spacing:-.5px;line-height:1.15}
.creator p{margin:8px 0 0;color:var(--sub);font-size:15px;line-height:1.5}
.perks{display:grid;gap:10px}
.perk{display:flex;align-items:center;gap:12px;padding:12px;border-radius:18px;background:var(--well);box-shadow:var(--neu-in-sm)}
.perk .tile-ic{width:42px;height:42px;border-radius:13px;background:var(--ground);box-shadow:var(--neu-out-sm)}
.perk b{display:block;font-size:15px}.perk span{display:block;font-size:13px;color:var(--sub);margin-top:1px}
.btn-ghost{height:52px;border:0;border-radius:17px;padding:0 20px;background:var(--ground);box-shadow:var(--neu-out-sm);color:var(--accent);font-size:16px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.btn-ghost:active{background:var(--well);box-shadow:var(--neu-in-sm)}
.app-band{position:relative;overflow:hidden;display:grid;gap:16px;padding:24px;border-radius:var(--r-xl);background:linear-gradient(150deg,#15162A 0%,#221B4E 60%,#2E1C66 100%);color:#fff;box-shadow:0 24px 48px rgba(20,16,60,.28),inset 0 1px 0 rgba(255,255,255,.1);contain:paint}
.app-band::before{content:"";position:absolute;right:-80px;top:-100px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.55),transparent 70%)}
.app-band>*{position:relative}
.app-band h3{margin:0;font-family:var(--font-display);font-size:24px;font-weight:800;letter-spacing:-.5px}
.app-band p{margin:6px 0 0;color:rgba(255,255,255,.8);font-size:15px;line-height:1.5}
.app-band .btn-install{height:52px;border-radius:17px;font-size:16px;width:100%}
.hint{display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.78)}
.faq details{border-radius:var(--r-md);background:var(--ground);box-shadow:var(--neu-out-sm);margin-top:10px;contain:paint}
.faq summary{cursor:pointer;list-style:none;padding:16px 18px;font-weight:650;font-size:15px;min-height:44px}
.faq summary::-webkit-details-marker{display:none}
.faq details p{margin:0;padding:0 18px 16px;color:var(--sub);font-size:14px;line-height:1.55}
.tools-links{display:flex;flex-wrap:wrap;gap:8px}
.tools-links a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:14px;background:var(--well);box-shadow:var(--neu-in-sm);font-size:14px;font-weight:600;text-decoration:none}
footer{padding:48px 0 calc(140px + env(safe-area-inset-bottom));color:var(--sub);font-size:14px}
footer .links{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:14px}
footer a{text-decoration:none;padding:12px 0;display:inline-block}footer a:hover{color:var(--ink)}
footer small{display:block;margin-top:18px;color:var(--muted)}
.tabbar{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:45;display:flex;align-items:center;gap:10px;max-width:520px;margin:0 auto}
.tabs{flex:1;height:70px;padding:6px;border-radius:26px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;background:var(--glass-solid);border:1px solid var(--glass-line);box-shadow:0 18px 40px rgba(16,18,40,.16)}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.tabs{background:var(--glass-strong);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}}
.tabs a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:20px;text-decoration:none;font-size:11.5px;font-weight:600;color:var(--sub)}
.tabs a[aria-current="page"]{color:var(--accent);background:var(--accent-soft)}
.me{width:70px;height:70px;flex:none;border-radius:24px;padding:2.5px;background:var(--brand);box-shadow:0 14px 28px rgba(79,70,229,.32);display:flex;text-decoration:none}
.me span{flex:1;border-radius:21.5px;background:var(--ground);display:flex;align-items:center;justify-content:center;color:var(--ink)}
dialog{border:0;padding:0;margin:auto auto 0;width:100%;max-width:560px;max-height:86vh;border-radius:30px 30px 0 0;color:var(--ink);background:var(--glass-solid);border-top:1px solid var(--glass-line);box-shadow:0 -20px 50px rgba(16,18,40,.25)}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){dialog[open]{background:var(--glass-strong);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}}
dialog[open]{animation:sheet .38s var(--spring)}
@keyframes sheet{from{transform:translateY(40%);opacity:.4}to{transform:none;opacity:1}}
dialog::backdrop{background:rgba(14,12,32,.42)}
.sheet{padding:10px 20px calc(24px + env(safe-area-inset-bottom))}
.grab{width:40px;height:5px;border-radius:3px;margin:0 auto 14px;background:rgba(127,127,140,.35)}
.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sheet-head h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.3px}
.plat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}
.plat{display:flex;align-items:center;gap:10px;min-height:52px;padding:0 14px;border-radius:16px;background:var(--ground);box-shadow:var(--neu-out-sm);font-size:15px;font-weight:600;text-decoration:none}
.plat i{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:13px;font-weight:800;color:#fff;background:var(--brand);flex:none}
.menu-list{display:grid;gap:8px;margin-top:14px}
.menu-list a{display:flex;align-items:center;gap:12px;height:56px;padding:0 14px;border-radius:16px;text-decoration:none;font-size:16px;font-weight:600;background:var(--ground);box-shadow:var(--neu-out-sm)}
.menu-list a svg{color:var(--accent)}
.news{display:grid;gap:10px;margin-top:14px}
.news article{padding:14px;border-radius:18px;background:var(--ground);box-shadow:var(--neu-out-sm)}
.news time{font-size:12px;font-weight:600;color:var(--muted)}
.news h3{margin:4px 0 0;font-size:16px;letter-spacing:-.2px}.news p{margin:4px 0 0;font-size:14px;color:var(--sub);line-height:1.45}
.toast{position:fixed;left:50%;top:calc(76px + env(safe-area-inset-top));z-index:60;transform:translate(-50%,-16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:10px 16px 10px 10px;border-radius:999px;white-space:nowrap;
background:var(--glass-solid);border:1px solid var(--glass-line);box-shadow:0 14px 30px rgba(16,18,40,.18);font-size:14px;font-weight:600;transition:transform .35s var(--spring),opacity .2s}
.toast.show{transform:translate(-50%,0);opacity:1}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.toast.show{background:var(--glass-strong);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}}
.toast .ok{width:28px;height:28px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center}
.toast.bad .ok{background:var(--err)}
.reveal{opacity:0;transform:translateY(14px);transition:opacity .6s var(--ease),transform .6s var(--ease)}
.reveal.in{opacity:1;transform:none}
.no-js .reveal{opacity:1;transform:none}
@media (min-width:960px){.nav-links{display:flex}.logo{margin-right:24px}.hero{grid-template-columns:1.05fr .95fr;align-items:center;padding:72px 0 16px;gap:56px}.lede{max-width:40ch}
.bento{grid-template-columns:repeat(4,minmax(0,1fr))}.tool.wide{grid-row:span 2;min-height:404px}.tool.wide .prompt{top:auto;bottom:110px}
.creator{grid-template-columns:1fr 1fr;align-items:center;padding:32px}.app-band{grid-template-columns:1fr auto;align-items:center;padding:32px 36px}.app-band .btn-install{width:auto;padding:0 28px}
.tabbar{display:none}footer{padding-bottom:56px}#menuBtn{display:none}}
@media (max-width:719px){.steps{grid-template-columns:1fr}.step{display:grid;grid-template-columns:30px 1fr;column-gap:14px;align-items:center}.step::before{grid-row:span 2}.step b{margin-top:0}.step span{margin-top:1px}}
@media (max-width:959px){.tool,.dl,.creator,.row-card{--neu-out:0 1px 1px rgba(16,24,40,.04),0 8px 20px -8px rgba(16,24,40,.14),0 0 0 1px rgba(16,24,40,.05)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}html{scroll-behavior:auto}}
@media (prefers-reduced-transparency:reduce){.header,.tabs,dialog[open],.toast.show{background:var(--glass-solid)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}
.save-data .art-ai::before,.save-data .app-band::before,.save-data .fan.a,.save-data .fan.b{display:none}
`;

/** Collapse whitespace and comments: the inlined bytes are what the visitor downloads. */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}
