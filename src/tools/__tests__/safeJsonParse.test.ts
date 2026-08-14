import { describe, expect, it } from 'vitest';
import { parseTransmissionResponse } from '../safeJsonParse';

describe('parseTransmissionResponse', () => {
  it('parses valid JSON unchanged', () => {
    const response = {
      result: 'success',
      arguments: { torrents: [{ id: 1, name: 'déjà vu — 100% legit.torrent' }] },
    };
    expect(parseTransmissionResponse(JSON.stringify(response))).toEqual(response);
  });

  it('repairs raw control characters inside string values', () => {
    const text =
      '{"result":"success","arguments":{"torrents":[{"id":1,"lastAnnounceResult":"tracker said\x04no"}]}}';
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseTransmissionResponse(text);
    const torrent = (parsed.arguments as { torrents: { lastAnnounceResult: string }[] })
      .torrents[0];
    expect(torrent.lastAnnounceResult).toBe('tracker said\x04no');
  });

  it('repairs invalid escape sequences inside string values', () => {
    const text =
      '{"result":"success","arguments":{"torrents":[{"announce":"http://t.example/a\\qb"}]}}';
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseTransmissionResponse(text);
    const torrent = (parsed.arguments as { torrents: { announce: string }[] }).torrents[0];
    expect(torrent.announce).toBe('http://t.example/a\\qb');
  });

  it('repairs truncated \\u escapes', () => {
    const text = '{"result":"success","arguments":{"a":"bad\\uZZ end"}}';
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseTransmissionResponse(text);
    expect(parsed.arguments.a).toBe('bad\\uZZ end');
  });

  it('does not corrupt names containing an "announce":" substring (old regex bug)', () => {
    const trickyName = 'weird "announce":"payload" torrent';
    const text =
      '{"result":"success","arguments":{"torrents":[{"id":7,"name":' +
      JSON.stringify(trickyName) +
      ',"lastAnnounceResult":"bad\x04value"}]}}';
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseTransmissionResponse(text);
    const torrent = (
      parsed.arguments as { torrents: { name: string; lastAnnounceResult: string }[] }
    ).torrents[0];
    expect(torrent.name).toBe(trickyName);
    expect(torrent.lastAnnounceResult).toBe('bad\x04value');
  });

  it('preserves legitimate escaped quotes and backslashes during repair', () => {
    const text = '{"result":"success","arguments":{"a":"he said \\"hi\\" \\\\ done","b":"x\x01y"}}';
    expect(() => JSON.parse(text)).toThrow();
    const parsed = parseTransmissionResponse(text);
    expect(parsed.arguments.a).toBe('he said "hi" \\ done');
    expect(parsed.arguments.b).toBe('x\x01y');
  });

  it('rethrows the original error for unrepairable input', () => {
    expect(() => parseTransmissionResponse('{"result": oops}')).toThrow(SyntaxError);
    expect(() => parseTransmissionResponse('not json at all')).toThrow(SyntaxError);
  });
});
