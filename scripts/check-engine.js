const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'tools', 'pjsua', process.platform === 'win32' ? 'pjsua.exe' : 'pjsua');
console.log(fs.existsSync(p) ? `OK: ${p}` : `MISSING: ${p}`);
process.exit(fs.existsSync(p) ? 0 : 1);
