require('./builder/defaultBuildEnv');
const {DefinePlugin, ProvidePlugin} = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

const outputPath = BUILD_ENV.outputPath;
const mode = BUILD_ENV.mode;
const devtool = BUILD_ENV.devtool;
const babelEnvOptions = BUILD_ENV.babelEnvOptions;
const browser = BUILD_ENV.browser;

const config = {
  entry: {
    bg: './src/bg/Bg',
    index: './src/pages/index',
    options: './src/pages/Options',
    tabUrlFetch: './src/tabUrlFetch',
  },
  output: {
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
    path: path.join(outputPath, 'src'),
    clean: false,
  },
  mode: mode,
  devtool: devtool,
  optimization: {
    // Enable module concatenation for smaller bundles
    concatenateModules: true,
    // Use deterministic IDs for better caching
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    splitChunks: {
      // Only split chunks for index and options, NOT for bg (service worker needs single file)
      chunks: chunk => ['index', 'options'].includes(chunk.name),
      cacheGroups: {
        // Vendor chunk for node_modules shared between index and options
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: chunk => ['index', 'options'].includes(chunk.name),
          priority: 20,
          reuseExistingChunk: true,
        },
        // Commons for shared application code
        commons: {
          name: 'commons',
          chunks: chunk => ['index', 'options'].includes(chunk.name),
          minChunks: 2,
          priority: 10,
          reuseExistingChunk: true,
        },
      }
    },
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          parse: {
            ecma: 2020,
          },
          compress: {
            ecma: 2020,
            comparisons: false,
            inline: 2,
            drop_console: mode === 'production',
            drop_debugger: true,
            pure_funcs: mode === 'production' ? ['console.log', 'console.info'] : [],
          },
          mangle: {
            safari10: true,
          },
          output: {
            ecma: 2020,
            comments: false,
            ascii_only: true,
          },
        },
        extractComments: false,
      }),
      new CssMinimizerPlugin({
        minimizerOptions: {
          preset: ['default', {
            discardComments: { removeAll: true },
            normalizeWhitespace: true,
          }],
        },
      }),
    ],
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-react',
              ['@babel/preset-env', babelEnvOptions],
              ['@babel/preset-typescript', {isTSX: true, allExtensions: true}]
            ]
          }
        }
      },
      {
        test: /\.(css|scss|sass)$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'sass-loader'
        ]
      },
      {
        test: /\.(gif|png|svg)$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 8192
          }
        }
      },
    ]
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fallback: {
      "url": require.resolve("url/"),
      "process": require.resolve("process/browser.js"),
    },
    alias: {
      "process/browser": require.resolve("process/browser.js"),
    }
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanStaleWebpackAssets: false,
      cleanOnceBeforeBuildPatterns: [
        outputPath,
      ]
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: './src/manifest.json',
          transform: (content) => {
            const manifest = JSON.parse(content);
            if (browser === 'firefox') {
              // Firefox V3: add gecko settings, remove Chrome-specific
              delete manifest.minimum_chrome_version;
              // Firefox has no extension service workers: an MV3 add-on
              // declaring only background.service_worker is REJECTED at install
              // ("background.service_worker is currently disabled"). The bundle
              // is a classic script, so an event page runs it as-is.
              manifest.background = {
                scripts: [manifest.background.service_worker],
              };
              // No `id` here on purpose: the AMO listing already owns the GUID
              // (the release workflow passes it as FIREFOX_ADDON_GUID), and
              // hardcoding a different one would orphan existing installs.
              manifest.browser_specific_settings = {
                gecko: {
                  // Host permissions are only granted at install from 127; on
                  // older versions the extension installs with no host access
                  // and every RPC fails with no way to grant it in-product.
                  strict_min_version: '127.0',
                },
              };
              // Required by AMO since 2025-11: declare that nothing is collected
              manifest.browser_specific_settings.gecko.data_collection_permissions = {
                required: ['none'],
              };
              // navigator.clipboard.writeText outside a user gesture needs this
              // on Firefox (Chrome grants it implicitly to extension pages)
              manifest.permissions = [...manifest.permissions, 'clipboardWrite'];
            }
            return JSON.stringify(manifest, null, 4);
          }
        },
        {from: './src/assets/icons', to: './assets/icons'},
        {from: './src/assets/img/notification_*.png', to: './assets/img/[name][ext]'},
        {from: './src/_locales', to: './_locales'},
      ]
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
      chunkFilename: '[name].chunk.css'
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: './src/templates/index.html',
      chunks: ['vendor', 'commons', 'index'],
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true,
      },
    }),
    new HtmlWebpackPlugin({
      filename: 'options.html',
      template: './src/templates/options.html',
      chunks: ['vendor', 'commons', 'options'],
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true,
      },
    }),
    new DefinePlugin({
      'BUILD_ENV': Object.entries(BUILD_ENV).reduce((obj, [key, value]) => {
        obj[key] = JSON.stringify(value);
        return obj;
      }, {}),
    }),
    new ProvidePlugin({
      process: 'process/browser',
    }),
  ]
};

module.exports = config;
