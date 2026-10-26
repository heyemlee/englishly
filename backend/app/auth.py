"""For running PodEcho on a public server: a password in front of the API, and turning off what only works on the Mac.

PODECHO_PASSWORD set: every /api call needs the session cookie from /api/login, or `Authorization: Bearer <password>`
(the Chrome extension uses that). Unset, as on the Mac, nothing changes.
PODECHO_MODE=cloud: importing (YouTube captions, channel lists, downloading audio, podcasts and Whisper) is refused,
because YouTube blocks cloud servers and Whisper needs Apple Silicon.
"""

import asyncio
import hashlib
import hmac
import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/api")

COOKIE = "podecho_session"
OPEN_PATHS = {"/api/health", "/api/login", "/api/logout"}
CLOUD_REFUSAL = "这台服务器不做导入：YouTube 会拦云服务器，Whisper 要用苹果芯片的 Mac，请在 Mac 上导入。"


def password() -> str:
    return os.getenv("PODECHO_PASSWORD", "")


def cloud() -> bool:
    return os.getenv("PODECHO_MODE", "").strip().lower() == "cloud"


def _session(pw: str) -> str:
    # Derived from the password, so changing it logs every device out.
    return hmac.new(pw.encode(), b"podecho-session", hashlib.sha256).hexdigest()


def authorized(request: Request) -> bool:
    pw = password()
    if not pw:
        return True
    if hmac.compare_digest(request.cookies.get(COOKIE, ""), _session(pw)):
        return True
    header = request.headers.get("authorization", "")
    return header.startswith("Bearer ") and hmac.compare_digest(header[7:].encode(), pw.encode())


def local_only() -> None:
    """Dependency for routes that need YouTube or Whisper."""
    if cloud():
        raise HTTPException(403, CLOUD_REFUSAL)


class LoginIn(BaseModel):
    password: str


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    pw = password()
    if pw and not hmac.compare_digest(body.password.encode(), pw.encode()):
        await asyncio.sleep(1)  # slows down guessing
        raise HTTPException(401, "密码不对。")
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE, _session(pw), max_age=365 * 24 * 3600, httponly=True, samesite="lax", secure=secure)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}
