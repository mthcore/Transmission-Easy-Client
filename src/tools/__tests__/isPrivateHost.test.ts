import { describe, it, expect } from 'vitest';
import isPrivateHost from '../isPrivateHost';

describe('isPrivateHost', () => {
  it('matches what URL parsing hands the redirect guard', () => {
    // downloadFileFromUrl passes new URL(response.url).hostname, not the raw
    // text of the Location header — the two differ for mapped addresses
    expect(new URL('http://[::ffff:127.0.0.1]/x.torrent').hostname).toBe('[::ffff:7f00:1]');
    expect(isPrivateHost(new URL('http://[::ffff:127.0.0.1]/x.torrent').hostname)).toBe(true);
  });

  it.each([
    'localhost',
    'anything.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '[::1]',
    '::1',
    '[fd12:3456::1]', // unique-local
    '[fe80::1]', // link-local
    // An IPv4 address wearing an IPv6 hat reaches the same machine. URL
    // parsing rewrites the dotted form, so both spellings have to be caught.
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]', // what new URL() actually produces for the line above
    '[::ffff:a9fe:a9fe]', // 169.254.169.254, cloud metadata
    '[::ffff:c0a8:1]', // 192.168.0.1
    '[64:ff9b::7f00:1]', // NAT64 onto loopback
  ])('treats %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    'example.com',
    'nas.example.org',
    '8.8.8.8',
    '172.32.0.1', // just outside 172.16/12
    '172.15.0.1',
    '169.253.0.1',
    '100.128.0.1',
    '[2001:db8::1]',
    '[::ffff:808:808]', // 8.8.8.8 mapped — public stays public
    '[::ffff:8.8.8.8]',
    '[2001:4860:4860::8888]',
  ])('treats %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});
