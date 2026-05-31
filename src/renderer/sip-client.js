/* global JsSIP */
class SipClient {
  constructor({ remoteAudio, onStatus, onLog, onCallState }) {
    this.ua = null;
    this.currentSession = null;
    this.remoteAudio = remoteAudio;
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.onCallState = onCallState;
    this.isMuted = false;
  }

  log(message, data) {
    const suffix = data ? ` ${JSON.stringify(data)}` : '';
    this.onLog(`[${new Date().toLocaleTimeString()}] ${message}${suffix}`);
  }

  isWebRtcTransport(config) {
    return ['webrtc-wss', 'webrtc-ws'].includes(config.transport);
  }

  buildWebSocketUrl(config) {
    if (config.websocketUrl && /^wss?:\/\//.test(config.websocketUrl)) return config.websocketUrl.trim();
    const scheme = config.transport === 'webrtc-ws' ? 'ws' : 'wss';
    const server = String(config.sipServer || '').trim();
    const port = String(config.wsPort || (scheme === 'wss' ? '8089' : '8088')).trim();
    const path = String(config.wsPath || '/ws').trim().startsWith('/') ? config.wsPath.trim() : `/${config.wsPath.trim()}`;
    return `${scheme}://${server}:${port}${path}`;
  }

  normalizeConfig(config) {
    const extension = String(config.extension || '').trim();
    const authUsername = String(config.authUsername || extension).trim();
    const domain = String(config.realm || config.sipServer || '').trim();
    const iceServers = String(config.iceServers || '').split(',').map((url) => url.trim()).filter(Boolean).map((url) => ({ urls: url }));
    return {
      ...config,
      extension,
      authUsername,
      domain,
      sipUri: `sip:${extension}@${domain}`,
      websocketUrl: this.buildWebSocketUrl(config),
      iceServers
    };
  }

  buildUA(config) {
    if (!this.isWebRtcTransport(config)) {
      throw new Error('این نسخه JavaScript/Electron با JsSIP فقط SIP over WebSocket/WebRTC را Register می‌کند. برای SIP UDP/TCP/TLS کلاسیک باید موتور native مثل PJSIP اضافه شود.');
    }
    const c = this.normalizeConfig(config);
    const socket = new JsSIP.WebSocketInterface(c.websocketUrl);
    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: c.sipUri,
      authorization_user: c.authUsername,
      password: c.password,
      display_name: c.displayName || c.extension,
      registrar_server: c.outboundProxy || undefined,
      register: true,
      register_expires: Number(c.registerExpires || 300),
      session_timers: Boolean(c.sessionTimers),
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
      pcConfig: { iceServers: c.iceServers }
    });

    ua.on('connecting', () => this.onStatus('connecting', `Connecting ${c.websocketUrl}`));
    ua.on('connected', () => this.onStatus('connected', 'WebSocket connected'));
    ua.on('disconnected', (e) => { this.onStatus('disconnected', 'WebSocket disconnected'); this.log('UA disconnected', { code: e.code, reason: e.reason }); });
    ua.on('registered', () => this.onStatus('registered', `Registered as ${c.extension}`));
    ua.on('unregistered', () => this.onStatus('disconnected', 'SIP unregistered'));
    ua.on('registrationFailed', (e) => { this.onStatus('failed', 'Registration failed'); this.log('Registration failed', { cause: e.cause }); });
    ua.on('newRTCSession', (event) => this.handleSession(event));
    return ua;
  }

  async start(config) {
    this.stop();
    this.ua = this.buildUA(config);
    this.ua.start();
    this.log('UA started');
  }

  stop() {
    if (this.currentSession) { try { this.currentSession.terminate(); } catch (_) {} this.currentSession = null; }
    if (this.ua) { try { this.ua.stop(); } catch (_) {} this.ua = null; }
    this.onCallState('Idle');
  }

  async call(target, config) {
    if (!this.ua || !this.ua.isRegistered()) throw new Error('ابتدا Register کنید.');
    const c = this.normalizeConfig(config);
    const destination = target.includes('@') ? `sip:${target}` : `sip:${target}@${c.domain}`;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.ua.call(destination, {
      mediaStream: stream,
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
    });
  }

  handleSession(event) {
    const session = event.session;
    this.currentSession = session;
    this.onCallState(event.originator === 'remote' ? 'Incoming call' : 'Calling...');
    if (event.originator === 'remote') {
      session.answer({ mediaConstraints: { audio: true, video: false } });
    }
    session.connection?.addEventListener('track', (e) => {
      if (e.streams && e.streams[0] && this.remoteAudio) this.remoteAudio.srcObject = e.streams[0];
    });
    session.on('progress', () => this.onCallState('Ringing'));
    session.on('accepted', () => this.onCallState('In Call'));
    session.on('confirmed', () => this.onCallState('Connected'));
    session.on('ended', () => { this.onCallState('Ended'); this.currentSession = null; });
    session.on('failed', (e) => { this.onCallState(`Failed: ${e.cause}`); this.currentSession = null; });
  }

  hangup() { if (this.currentSession) this.currentSession.terminate(); }

  toggleMute() {
    if (!this.currentSession?.connection) return false;
    this.isMuted = !this.isMuted;
    this.currentSession.connection.getSenders().forEach((sender) => { if (sender.track?.kind === 'audio') sender.track.enabled = !this.isMuted; });
    return this.isMuted;
  }
}

window.SipClient = SipClient;
