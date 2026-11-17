import { Writable } from 'node:stream';
import { createLogger, logFailure } from '../../infrastructure/logging/logger';

describe('safe infrastructure diagnostics', () => {
  it.each([
    ['3D000', 'Configured database does not exist'],
    ['28P01', 'Database authentication failed'],
    ['ENOTFOUND', 'Host could not be resolved'],
    ['ECONNREFUSED', 'Connection refused'],
    ['EADDRINUSE', 'Listen address is already in use'],
  ])('keeps actionable diagnostics for %s without logging driver messages', (code, reason) => {
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const error = Object.assign(new Error('postgresql://user:secret@host/db'), { code });
    logFailure(createLogger('info', sink), 'startup', error);
    expect(JSON.parse(output)).toMatchObject({ component: 'startup', errorCode: code, reason });
    expect(output).not.toContain('secret');
  });

  it('omits unrecognized error codes that might contain sensitive values', () => {
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    logFailure(createLogger('info', sink), 'startup', { code: 'passwordsecret' });
    expect(JSON.parse(output).errorCode).toBeUndefined();
    expect(output).not.toContain('passwordsecret');
  });
});
