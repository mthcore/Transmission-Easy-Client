import { describe, it, expect } from 'vitest';
import isPrivateHost from '../isPrivateHost';

describe('isPrivateHost', () => {
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
  ])('treats %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});
