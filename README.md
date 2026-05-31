# Asterisk Native Softphone

Electron UI + Native PJSUA engine for classic SIP UDP/TCP/TLS registration and calls.

## Quick start

```bat
npm start
```

The SIP engine path is:

```txt
tools\pjsua\pjsua.exe
```

This package includes the `pjsua.exe` that was provided for testing. If you replace it, keep the same name and path.

## Basic SIP config

- Account Name: any label, e.g. Sales 101
- Server 1: Issabel/Asterisk IP, e.g. 192.168.1.10
- Extension / Username: e.g. 101
- Password: extension secret
- Transport: usually UDP
- Port: usually 5060

Queues, Ring Groups and IVR are dialed like normal numbers, e.g. 600 or 700.

## Test engine manually

```bat
tools\pjsua\pjsua.exe --version
```

## Build portable

```bat
npm run dist:dir
```


## Git / GitHub

Before pushing to GitHub, decide whether you are legally and operationally allowed to commit `tools/pjsua/pjsua.exe`. If you want the repository to run immediately after clone, keep it. If you prefer a clean source repository, uncomment `tools/pjsua/pjsua.exe` in `.gitignore` and document where to place it.

Recommended first push:

```bat
git init
git add .
git commit -m "Initial Sierra Phone softphone project"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sierra-phone.git
git push -u origin main
```

Do not commit `node_modules`, `dist`, generated installers, or local `.env` files.
