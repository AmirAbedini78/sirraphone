const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = this._read();
  }
  _read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (_) { return {}; }
  }
  _write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
  getAll() { return this.data || {}; }
  setAll(value) { this.data = value || {}; this._write(); }
}
module.exports = Store;
