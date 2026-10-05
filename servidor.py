#!/usr/bin/env python3
"""
Servidor local do Scrobble Audit: serve o site e o proxy da Last.fm em
/api/lastfm — o mesmo caminho da Vercel Function (api/lastfm.js), então o
frontend funciona igual localmente e em produção.

A API key fica SOMENTE aqui no servidor (arquivo .env ou variável de ambiente
LASTFM_API_KEY). O navegador nunca a recebe.

Uso:
    python servidor.py                 # http://localhost:5173
    python servidor.py --port 8080 --open

Somente biblioteca padrão do Python 3.8+.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LASTFM_URL = "https://ws.audioscrobbler.com/2.0/"
PROXY_PATH = "/api/lastfm"

# Mesmas regras de api/lastfm.js.
ALLOWED_METHODS = {"user.getrecenttracks", "user.getinfo", "track.getinfo"}
ALLOWED_PARAMS = {"user", "from", "to", "page", "limit", "extended", "artist", "track", "autocorrect", "mbid"}

# Nunca servir ao navegador: dotfiles (.env, .git...), o próprio servidor e o código do proxy.
BLOCKED_NAMES = {"servidor.py", "config.local.js"}
BLOCKED_DIRS = {"api"}


def load_api_key():
    key = os.environ.get("LASTFM_API_KEY", "").strip()
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("LASTFM_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("'\"")
    return key


def load_security_headers():
    """Reaproveita os cabeçalhos de vercel.json para o ambiente local ficar igual à produção."""
    try:
        cfg = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
        return [(h["key"], h["value"]) for rule in cfg.get("headers", []) if rule.get("source") == "/(.*)" for h in rule["headers"]]
    except (OSError, ValueError, KeyError):
        return []


API_KEY = load_api_key()
SECURITY_HEADERS = load_security_headers()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # tests/smoke.html usa script inline (página de teste), então fica fora da CSP.
        if not self.path.startswith("/tests/"):
            for k, v in SECURITY_HEADERS:
                self.send_header(k, v)
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == PROXY_PATH:
            return self.proxy(parsed.query)
        parts = [p for p in path.split("/") if p]
        if any(p.startswith(".") for p in parts) or (parts and (parts[-1] in BLOCKED_NAMES or parts[0] in BLOCKED_DIRS)):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def proxy(self, query):
        if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
            return self.json(403, {"error": 4, "message": "Uso do proxy a partir de outro site não é permitido."})
        params = urllib.parse.parse_qsl(query)
        method = dict(params).get("method", "").lower()
        if method not in ALLOWED_METHODS:
            return self.json(400, {"error": 3, "message": "Método não permitido pelo proxy."})
        if not API_KEY:
            return self.json(500, {"error": 10, "message": "Proxy sem LASTFM_API_KEY configurada no servidor (crie o arquivo .env)."})
        upstream = [(k, v) for k, v in params if k in ALLOWED_PARAMS]
        upstream += [("method", method), ("api_key", API_KEY), ("format", "json")]
        req = urllib.request.Request(
            LASTFM_URL + "?" + urllib.parse.urlencode(upstream),
            headers={"User-Agent": "ScrobbleAudit-LocalProxy/1.0", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as res:
                return self.respond(res.status, res.read())
        except urllib.error.HTTPError as e:
            return self.respond(e.code, e.read())
        except (urllib.error.URLError, TimeoutError):
            return self.json(502, {"error": 11, "message": "Falha ao contatar a Last.fm."})

    def json(self, status, obj):
        self.respond(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def guess_type(self, path):
        # O Windows às vezes mapeia .js como text/plain, o que quebra ES modules.
        if str(path).endswith(".js"):
            return "text/javascript"
        return super().guess_type(path)


def main():
    ap = argparse.ArgumentParser(description="Servidor local do Scrobble Audit (site + proxy da Last.fm).")
    ap.add_argument("--port", type=int, default=5173)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="abre o navegador")
    args = ap.parse_args()

    url = f"http://localhost:{args.port}/"
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Scrobble Audit em {url}")
    if API_KEY:
        print(f"Proxy da Last.fm ativo em {PROXY_PATH} (key carregada do servidor: ...{API_KEY[-4:]}).")
    else:
        print("AVISO: LASTFM_API_KEY não encontrada. Copie .env.example para .env e preencha a key.")
    print("Ctrl+C para parar.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
