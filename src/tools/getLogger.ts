import { recordDiagnostic } from './diagnosticLog';

declare const BUILD_ENV: {
  browser: string;
  mode: string;
  outputPath: string;
  /** Chatter: log, info and debug. Compiled out of a production build. */
  FLAG_ENABLE_LOGGER?: boolean;
};

interface Logger {
  (...args: unknown[]): void;
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

const colors = [
  '#0000CC',
  '#0000FF',
  '#0033CC',
  '#0033FF',
  '#0066CC',
  '#0066FF',
  '#0099CC',
  '#0099FF',
  '#00CC00',
  '#00CC33',
  '#00CC66',
  '#00CC99',
  '#00CCCC',
  '#00CCFF',
  '#3300CC',
  '#3300FF',
  '#3333CC',
  '#3333FF',
  '#3366CC',
  '#3366FF',
  '#3399CC',
  '#3399FF',
  '#33CC00',
  '#33CC33',
  '#33CC66',
  '#33CC99',
  '#33CCCC',
  '#33CCFF',
  '#6600CC',
  '#6600FF',
  '#6633CC',
  '#6633FF',
  '#66CC00',
  '#66CC33',
  '#9900CC',
  '#9900FF',
  '#9933CC',
  '#9933FF',
  '#99CC00',
  '#99CC33',
  '#CC0000',
  '#CC0033',
  '#CC0066',
  '#CC0099',
  '#CC00CC',
  '#CC00FF',
  '#CC3300',
  '#CC3333',
  '#CC3366',
  '#CC3399',
  '#CC33CC',
  '#CC33FF',
  '#CC6600',
  '#CC6633',
  '#CC9900',
  '#CC9933',
  '#CCCC00',
  '#CCCC33',
  '#FF0000',
  '#FF0033',
  '#FF0066',
  '#FF0099',
  '#FF00CC',
  '#FF00FF',
  '#FF3300',
  '#FF3333',
  '#FF3366',
  '#FF3399',
  '#FF33CC',
  '#FF33FF',
  '#FF6600',
  '#FF6633',
  '#FF9900',
  '#FF9933',
  '#FFCC00',
  '#FFCC33',
];

function selectColor(namespace: string): string {
  let hash = 0;

  for (let i = 0; i < namespace.length; i++) {
    hash = (hash << 5) - hash + namespace.charCodeAt(i);
    hash |= 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Serializes arguments to ensure error objects are logged correctly
 */
function serializeArgs(...args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    if (arg && typeof arg === 'object' && 'message' in arg) {
      return (arg as { message?: string }).message || String(arg);
    }
    return arg;
  });
}

/**
 * Two levels, and only one of them is optional.
 *
 * The chatter — log, info, debug — is a development aid: one line per poll,
 * per autorun, per request. It is compiled out of a production build and
 * should stay that way.
 *
 * Warnings and errors are not chatter, and used to be silenced with it. That
 * left a shipped extension whose failures were observable by nobody: not by
 * the user, who sees an action quietly not happen, and not by the developer,
 * because the service worker that held the console was torn down minutes
 * before the bug report was written. They now always emit, and are recorded
 * for the Diagnostics pane to hand back.
 */
const getLogger = (name: string): Logger => {
  const verbose = typeof BUILD_ENV !== 'undefined' && Boolean(BUILD_ENV.FLAG_ENABLE_LOGGER);
  const colorArgs: string[] = [];
  if (verbose && typeof BUILD_ENV !== 'undefined' && BUILD_ENV.mode === 'development') {
    colorArgs.push(`%c${name}`, `color: ${selectColor(name)}`);
  } else {
    colorArgs.push(name);
  }

  const noop = () => {};
  const chatter =
    (method: 'log' | 'info' | 'debug') =>
    (...args: unknown[]) =>
      console[method](...colorArgs, ...serializeArgs(...args));

  const fn = (verbose ? chatter('log') : noop) as Logger;
  fn.log = fn;
  fn.info = verbose ? chatter('info') : noop;
  fn.debug = verbose ? chatter('debug') : noop;
  fn.warn = (...args: unknown[]) => {
    console.warn(...colorArgs, ...serializeArgs(...args));
    recordDiagnostic('warn', name, args);
  };
  fn.error = (...args: unknown[]) => {
    console.error(...colorArgs, ...serializeArgs(...args));
    recordDiagnostic('error', name, args);
  };
  return fn;
};

export default getLogger;
