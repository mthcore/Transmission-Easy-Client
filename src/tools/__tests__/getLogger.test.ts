import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const record = vi.hoisted(() => vi.fn());
vi.mock('../diagnosticLog', () => ({ recordDiagnostic: record }));

import getLogger from '../getLogger';

/**
 * Two levels, and only one of them is optional.
 *
 * The chatter — log, info, debug — is one line per poll, per autorun, per
 * request. It is a development aid and is compiled out of a production build.
 *
 * Warnings and errors used to be silenced along with it, which left a shipped
 * extension whose failures were observable by nobody: not by the user, who
 * sees an action quietly not happen, and not by the developer, because the
 * service worker holding the console was torn down long before the bug report
 * was written. They now always emit, and are recorded for the Diagnostics pane.
 *
 * BUILD_ENV is not defined under test, which is the same shape a production
 * build has. The cases below therefore drive the SHIPPED configuration by
 * default, and switch the chatter on explicitly where that is the subject.
 */

type Env = { mode: string; FLAG_ENABLE_LOGGER?: boolean };
const globals = globalThis as unknown as { BUILD_ENV?: Env };

/** Call getLogger with the chatter switched on, as a development build has it. */
function verboseLogger(name: string) {
  globals.BUILD_ENV = { mode: 'development', FLAG_ENABLE_LOGGER: true };
  const logger = getLogger(name);
  delete globals.BUILD_ENV;
  return logger;
}

const spies = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
  delete globals.BUILD_ENV;
});

afterEach(() => {
  delete globals.BUILD_ENV;
});

describe('getLogger — a production build', () => {
  it('says nothing on log, info or debug', () => {
    const logger = getLogger('Bg');

    logger('polling');
    logger.log('polling');
    logger.info('autorun');
    logger.debug('detail');

    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.debug).not.toHaveBeenCalled();
  });

  it('still reports an error', () => {
    // The whole point. This used to be a no-op in everything we shipped.
    const logger = getLogger('Bg');

    logger.error('init error', new Error('boom'));

    expect(spies.error).toHaveBeenCalled();
  });

  it('still reports a warning', () => {
    const logger = getLogger('Bg');

    logger.warn('rejected a message from outside the extension');

    expect(spies.warn).toHaveBeenCalled();
  });
});

describe('getLogger — what reaches the Diagnostics log', () => {
  it('records an error under its namespace', () => {
    getLogger('TorrentService').error('daemon unreachable');

    expect(record).toHaveBeenCalledWith('error', 'TorrentService', ['daemon unreachable']);
  });

  it('records a warning as a warning, not as an error', () => {
    // The pane shows the level, and a warning read as an error sends people
    // looking for a failure that did not happen.
    getLogger('Bg').warn('slow');

    expect(record).toHaveBeenCalledWith('warn', 'Bg', ['slow']);
  });

  it('passes the arguments through unflattened, so the Error survives', () => {
    // The recorder reduces an Error to its name and message; handing it a
    // pre-formatted string instead would lose the name.
    const err = new TypeError('boom');

    getLogger('Bg').error('init error', err);

    expect(record).toHaveBeenCalledWith('error', 'Bg', ['init error', err]);
  });

  it('does not record the chatter, even when the chatter is on', () => {
    // Fifty entries of "polling" would push out everything worth reading.
    const logger = verboseLogger('Bg');

    logger.log('polling');
    logger.info('autorun');
    logger.debug('detail');

    expect(record).not.toHaveBeenCalled();
  });
});

describe('getLogger — a development build', () => {
  it('speaks on log, info and debug', () => {
    const logger = verboseLogger('Bg');

    logger.log('polling');
    logger.info('autorun');
    logger.debug('detail');

    expect(spies.log).toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalled();
    expect(spies.debug).toHaveBeenCalled();
  });

  it('colours the namespace, which is what makes a busy console readable', () => {
    const logger = verboseLogger('TorrentService');

    logger.log('x');

    expect(spies.log.mock.calls[0][0]).toBe('%cTorrentService');
  });

  it('still records its errors', () => {
    verboseLogger('Bg').error('boom');

    expect(record).toHaveBeenCalledWith('error', 'Bg', ['boom']);
  });
});
