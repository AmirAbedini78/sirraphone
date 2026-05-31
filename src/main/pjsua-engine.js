const fs = require('fs');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const { spawn, spawnSync } = require('child_process');

class PjsuaEngine {
  constructor({ projectRoot, userDataPath, resourcesPath, onLog, onStatus }) {
    this.projectRoot = projectRoot;
    this.userDataPath = userDataPath;
    this.resourcesPath = resourcesPath || process.resourcesPath;
    this.onLog = onLog || (() => {});
    this.onStatus = onStatus || (() => {});
    this.proc = null;
    this.status = 'stopped';
    this.lastConfig = null;
  }

  engineFileName() { return process.platform === 'win32' ? 'pjsua.exe' : 'pjsua'; }

  candidateEnginePaths() {
    const file = this.engineFileName();
    const candidates = [
      path.join(this.projectRoot, 'tools', 'pjsua', file),
      path.join(process.cwd(), 'tools', 'pjsua', file),
      path.join(this.resourcesPath || '', 'tools', 'pjsua', file),
      path.join(this.resourcesPath || '', 'app', 'tools', 'pjsua', file),
      path.join(path.dirname(process.execPath || ''), 'tools', 'pjsua', file),
      path.join(path.dirname(process.execPath || ''), 'resources', 'tools', 'pjsua', file),
      path.join(path.dirname(process.execPath || ''), 'resources', 'app', 'tools', 'pjsua', file)
    ];
    return [...new Set(candidates.filter(Boolean))];
  }

  enginePath() { return this.candidateEnginePaths().find((p) => fs.existsSync(p)) || this.candidateEnginePaths()[0]; }

  check() {
    const candidates = this.candidateEnginePaths();
    const exe = this.enginePath();
    const exists = fs.existsSync(exe);
    let version = '', runnable = false, runError = '', timedOut = false;

    if (exists) {
      try {
        // PJSUA is an interactive CLI. Some builds print version/config and then stay open,
        // so spawnSync may return ETIMEDOUT even when the binary is healthy.
        // In that case we must treat it as runnable.
        const r = spawnSync(exe, ['--version'], {
          cwd: path.dirname(exe),
          encoding: 'utf8',
          timeout: 2500,
          windowsHide: true
        });

        const combined = String((r.stdout || '') + (r.stderr || ''));
        version = combined.split(/\r?\n/).filter(Boolean).slice(0, 12).join('\n');

        if (!r.error) {
          runnable = true;
        } else if (r.error && r.error.code === 'ETIMEDOUT') {
          timedOut = true;
          runnable = true;
          if (!version) version = 'PJSUA process started and stayed open. This is normal for interactive pjsua.exe builds.';
        } else {
          runError = r.error.message || String(r.error);
        }
      } catch (e) {
        runError = e.message;
      }
    }

    const ok = exists && runnable;
    return {
      ok,
      exists,
      runnable,
      timedOut,
      path: exe,
      candidates,
      version,
      message: !exists
        ? 'pjsua.exe not found. Put it in tools\\pjsua\\pjsua.exe.'
        : ok
          ? (timedOut
              ? 'PJSUA engine found and started successfully. Timeout is normal because pjsua.exe is an interactive CLI.'
              : 'PJSUA engine found and executable.')
          : `pjsua.exe found but could not run: ${runError}`
    };
  }

  log(level, message, raw) { this.onLog({ time: new Date().toLocaleTimeString(), level, message, raw: raw || '' }); }
  setStatus(status) { this.status = status; this.onStatus({ status }); }

  normalizeConfig(cfg) {
    const c = Object.assign({ accountName: 'Main Extension', server1: '', server2: '', server3: '', extension: '', username: '', password: '', port: '5060', transport: 'udp', domain: '', outboundProxy: '', localPort: '5066', logLevel: '4', nullAudio: false }, cfg || {});
    c.username = String(c.username || c.extension || '').trim();
    c.extension = String(c.extension || c.username || '').trim();
    c.server1 = String(c.server1 || '').trim();
    c.domain = String(c.domain || c.server1 || '').trim();
    c.transport = String(c.transport || 'udp').toLowerCase();
    c.port = String(c.port || '5060').trim();
    return c;
  }

  sipServerUri(c) { const t = c.transport && c.transport !== 'udp' ? `;transport=${c.transport}` : ''; return `sip:${c.server1}:${c.port}${t}`; }
  accountUri(c) { return `sip:${c.username}@${c.domain || c.server1}`; }
  destinationUri(number) { const c = this.normalizeConfig(this.lastConfig || {}); const n = String(number || '').trim(); if (n.startsWith('sip:')) return n; return `sip:${n}@${c.domain || c.server1}`; }

  buildArgs(cfg) {
    const c = this.normalizeConfig(cfg);
    const args = ['--id', this.accountUri(c), '--registrar', this.sipServerUri(c), '--realm', '*', '--username', c.username, '--password', c.password, '--local-port', String(c.localPort || '5066'), '--log-level', String(c.logLevel || '4'), '--app-log-level', String(c.logLevel || '4'), '--auto-update-nat', '0'];
    if (c.transport === 'tcp') args.push('--no-udp', '--use-tcp');
    if (c.transport === 'tls') args.push('--no-udp', '--use-tls');
    if (c.outboundProxy) args.push('--proxy', c.outboundProxy);
    if (String(c.nullAudio) === 'true') args.push('--null-audio');
    return args;
  }

  async start(cfg) {
    if (this.proc) return { ok: true, message: 'Engine already running.' };
    const check = this.check();
    if (!check.ok) { this.log('error', check.message); this.setStatus(check.exists ? 'engine-error' : 'missing-engine'); return check; }
    const c = this.normalizeConfig(cfg);
    this.lastConfig = c;
    if (!c.server1 || !c.username || !c.password) return { ok: false, message: 'Server 1, extension/username and password are required.' };
    const args = this.buildArgs(c);
    const exe = this.enginePath();
    this.log('info', `Starting PJSUA from: ${exe}`);
    this.log('debug', `${path.basename(exe)} ${args.map((a) => a === c.password ? '***' : a).join(' ')}`);
    this.proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.setStatus('starting');
    this.proc.stdout.on('data', (d) => this.handleOutput(d.toString()));
    this.proc.stderr.on('data', (d) => this.handleOutput(d.toString(), true));
    this.proc.on('error', (err) => { this.log('error', err.message); this.setStatus('error'); });
    this.proc.on('exit', (code) => { this.log(code === 0 ? 'info' : 'warn', `PJSUA exited with code ${code}`); this.proc = null; this.setStatus('stopped'); });
    return { ok: true, message: 'PJSUA started. Watch logs for registration result.' };
  }

  handleOutput(text, isErr) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('ready: success')) { this.setStatus('running'); this.log('success', line, line); }
      else if (lower.includes('registration success') || lower.includes('registration status=200') || lower.includes('sip/2.0 200') || lower.includes(' 200/ok')) { this.setStatus('registered'); this.log('success', line, line); }
      else if (lower.includes('registration failed') || lower.includes('forbidden') || lower.includes(' 403') || lower.includes('status=403') || lower.includes('timeout')) { this.setStatus('register-failed'); this.log('error', line, line); }
      else if (lower.includes('unauthorized') || lower.includes(' 401') || lower.includes('status=401')) { this.log('warn', line, line); }
      else if (lower.includes('incoming call')) { this.setStatus('incoming-call'); this.log('call', line, line); }
      else if (lower.includes('call') || lower.includes('media') || lower.includes('sound') || lower.includes('audio')) { this.log('call', line, line); }
      else { this.log(isErr ? 'warn' : 'info', line, line); }
    }
  }

  sendCommand(command) {
    if (!this.proc || !this.proc.stdin.writable) return { ok: false, message: 'Engine is not running.' };
    this.proc.stdin.write(command.endsWith('\n') ? command : `${command}\n`);
    this.log('debug', `> ${command.replace(/\n/g, '\\n')}`);
    return { ok: true };
  }
  call(number) { const n = String(number || '').trim(); if (!n) return { ok: false, message: 'Destination number is empty.' }; return this.sendCommand(`m\n${this.destinationUri(n)}\n`); }
  hangup() { return this.sendCommand('h'); }
  sendDtmf(digit) { const d = String(digit || '').trim(); if (!d) return { ok: false, message: 'DTMF digit is empty.' }; return this.sendCommand(`#\n${d}\n`); }
  stop() { if (!this.proc) return { ok: true, message: 'Engine already stopped.' }; try { this.proc.stdin.write('q\n'); } catch (_) {} setTimeout(() => { try { if (this.proc) this.proc.kill(); } catch (_) {} }, 800); this.proc = null; this.setStatus('stopped'); return { ok: true }; }

  testNetwork(cfg) { const c = this.normalizeConfig(cfg); const host = c.server1; const port = Number(c.port || 5060); if (!host) return Promise.resolve({ ok: false, message: 'SIP Server 1 is empty.' }); if (c.transport === 'udp') return this.testUdp(host, port); return this.testTcp(host, port); }
  testTcp(host, port) { return new Promise((resolve) => { const socket = new net.Socket(); const done = (ok, message) => { socket.destroy(); resolve({ ok, message }); }; socket.setTimeout(5000); socket.once('connect', () => done(true, `TCP connection to ${host}:${port} succeeded.`)); socket.once('timeout', () => done(false, `TCP timeout to ${host}:${port}.`)); socket.once('error', (e) => done(false, `TCP failed: ${e.message}`)); socket.connect(port, host); }); }
  testUdp(host, port) { return new Promise((resolve) => { const socket = dgram.createSocket('udp4'); const msg = Buffer.from('OPTIONS sip:test SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:5066\r\nFrom: <sip:test@localhost>\r\nTo: <sip:test@localhost>\r\nCall-ID: test-call-id\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n'); let finished = false; const finish = (ok, message) => { if (finished) return; finished = true; try { socket.close(); } catch (_) {} resolve({ ok, message }); }; socket.on('message', () => finish(true, `UDP response received from ${host}:${port}.`)); socket.on('error', (e) => finish(false, `UDP error: ${e.message}`)); socket.send(msg, port, host, (err) => { if (err) finish(false, `UDP send failed: ${err.message}`); }); setTimeout(() => finish(true, `UDP packet sent to ${host}:${port}. No response does not always mean failure.`), 3000); }); }
}

module.exports = PjsuaEngine;
