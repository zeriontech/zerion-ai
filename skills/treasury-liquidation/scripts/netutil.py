"""HTTP helpers.

Both api.zerion.io and public RPC endpoints reject Python's default urllib
User-Agent with 403. Every request here sets a browser-ish UA. Without it you get
a 403 that looks exactly like a bad API key.
"""
import base64, json, urllib.request

UA = "Mozilla/5.0 (treasury-liquidation)"


def get_json(url, api_key=None, timeout=60):
    headers = {"accept": "application/json", "User-Agent": UA}
    if api_key:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{api_key}:".encode()).decode()
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def head_status(url, api_key=None, timeout=15):
    """Return an HTTP status code without raising, for liveness checks."""
    headers = {"accept": "application/json", "User-Agent": UA}
    if api_key:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{api_key}:".encode()).decode()
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def rpc(url, method, params, timeout=20):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    if "error" in d:
        raise RuntimeError(d["error"])
    return d["result"]
