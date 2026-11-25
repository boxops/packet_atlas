import { describe, expect, it } from 'vitest';
import { complete, resolveCommand } from '../src/core/cli';

const cmds = ['show version', 'show interfaces brief', 'show lldp neighbors', 'show ip route summary', 'show processes cpu sorted'];

describe('console command resolution', () => {
  it('accepts exact commands, case-insensitively', () => {
    expect(resolveCommand('show version', cmds)).toEqual({ ok: true, cmd: 'show version' });
    expect(resolveCommand('  SHOW   Version ', cmds)).toEqual({ ok: true, cmd: 'show version' });
  });

  it('expands network-OS style abbreviations', () => {
    expect(resolveCommand('sh ver', cmds)).toEqual({ ok: true, cmd: 'show version' });
    expect(resolveCommand('sh int br', cmds)).toEqual({ ok: true, cmd: 'show interfaces brief' });
    expect(resolveCommand('sh ip ro sum', cmds)).toEqual({ ok: true, cmd: 'show ip route summary' });
  });

  it('reports invalid and ambiguous input', () => {
    const bad = resolveCommand('reload', cmds);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Invalid input/);
    const amb = resolveCommand('s v', ['show version', 'set vlan']);
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.error).toMatch(/Ambiguous/);
  });
});

describe('tab completion', () => {
  it('completes a unique command', () => {
    expect(complete('show ver', cmds)).toEqual({ value: 'show version ', options: [] });
    expect(complete('sh int', cmds).value).toBe('show interfaces brief ');
  });

  it('completes the shared word and lists options when ambiguous', () => {
    expect(complete('sh', cmds).value).toBe('show ');
    const c = complete('show ', cmds);
    expect(c.value).toBe('show ');
    expect(c.options).toHaveLength(5);
  });

  it('leaves unknown input alone', () => {
    expect(complete('xyz', cmds)).toEqual({ value: 'xyz', options: [] });
  });
});
