const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class NativePjsuaEngine {
  constructor({ appRoot, userDataPath, emit }) {
    this.appRoot = appRoot;
    this.userDataPath = userDataPath;
    this.emit = emit || (() => {});
    this.proc = null;
    this.currentConfig = null;
  }

  getBinPath() {
    const exe = process.platform === 'win32' ? 'pjsua.exe' : 'pjsua';
    const candidates = [
      path.join(this.appRoot, 'tools', 'pjsua', exe),
      path.join(process.resourcesPath || '', 'tools', 'pjsua', exe),
      path.join(process.cwd(), 'tools', 'pjsua', exe)
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates[0];
  }

  isRunning() {
    return Boolean(this.proc && !this.proc.killed);
  }

  buildArgs(config) {
    const server = String(config.sipServer || config.server1 || '').trim();
    const extension = String(config.extension || '').trim();
    const username = String(config.authUsername || extension).trim();
    const password = String(config.password || '').trim();
    const port = String(config.sipPort || (config.transport === 'tls' ? '5061' : '5060')).trim();
    const transport = String(config.transport || 'udp').toLowerCase();
    const domain = String(config.realm || server).trim();
    const accountUri = `sip:${extension}@${domain}`;
    const registrar = `sip:${server}:${port}`;
    const args = [
      '--id', accountUri,
      '--registrar', registrar,
      '--realm', '*',
      '--username', username,
      '--password', password,
      '--local-port', '0',
      '--null-audio',
      '--auto-answer', '200',
      '--duration', '36000',
      '--log-level', '4',
      '--app-log-level', '4'
    ];

    if (transport === 'tcp') {
      args.push('--proxy', `sip:${server}:${port};transport=tcp`);
    }
    if (transport === 'tls') {
      args.push('--use-tls');
      args.push('--proxy', `sips:${server}:${port};transport=tls`);
    }
    if (config.outboundProxy) {
      args.push('--proxy', String(config.outboundProxy));
    }
    if (config.stunServer) {
      args.push('--stun-srv', String(config.stunServer));
    }
    return args;
  }

  start(config) {
    if (this.isRunning()) this.stop();
    const bin = this.getBinPath();
    if (!fs.existsSync(bin)) {
      throw new Error(`PJSUA native engine not found. Put pjsua.exe here: ${bin}`);
    }
    this.currentConfig = config;
    const args = this.buildArgs(config);
    this.emit('native:log', `Starting PJSUA: ${bin} ${args.join(' ')}`);
    this.proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (data) => this.handleOutput(data.toString('utf8')));
    this.proc.stderr.on('data', (data) => this.handleOutput(data.toString('utf8')));
    this.proc.on('exit', (code, signal) => {
      this.emit('native:status', { status: 'stopped', message: `PJSUA stopped code=${code} signal=${signal || ''}` });
      this.proc = null;
    });
    this.proc.on('error', (err) => {
      this.emit('native:status', { status: 'failed', message: err.message });
    });
    this.emit('native:status', { status: 'starting', message: 'Native SIP engine starting...' });
    return { ok: true, message: 'Native SIP engine started' };
  }

  handleOutput(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      this.emit('native:log', line);
      const l = line.toLowerCase();
      if (l.includes('registration success') || l.includes('sip registration success')) {
        this.emit('native:status', { status: 'registered', message: 'Registered via SIP classic engine' });
      }
      if (l.includes('registration failed') || l.includes('unauthorized') || l.includes('forbidden')) {
        this.emit('native:status', { status: 'failed', message: line });
      }
      if (l.includes('call') && (l.includes('confirmed') || l.includes('connected'))) {
        this.emit('native:call', { state: 'Connected', message: line });
      }
      if (l.includes('disconnected') || l.includes('hangup')) {
        this.emit('native:call', { state: 'Ended', message: line });
      }
    }
  }

  send(command) {
    if (!this.isRunning()) throw new Error('Native SIP engine is not running.');
    this.proc.stdin.write(`${command}\n`);
  }

  call(target) {
    if (!target) throw new Error('Target number is required.');
    this.send('m');
    setTimeout(() => this.send(String(target)), 120);
    this.emit('native:call', { state: 'Calling...', message: `Calling ${target}` });
    return { ok: true };
  }

  hangup() {
    if (this.isRunning()) this.send('h');
    this.emit('native:call', { state: 'Hangup requested' });
    return { ok: true };
  }

  stop() {
    if (!this.proc) return { ok: true, message: 'Native SIP engine already stopped' };
    try { this.proc.stdin.write('q\n'); } catch (_) {}
    setTimeout(() => {
      try { if (this.proc) this.proc.kill(); } catch (_) {}
    }, 1500);
    return { ok: true, message: 'Stop requested' };
  }
}

module.exports = NativePjsuaEngine;
