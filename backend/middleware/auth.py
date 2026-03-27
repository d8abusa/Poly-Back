"""
JWT authentication middleware.

Single-user model: one admin password checked at login.
All protected routes require a valid Bearer token.
"""

import os
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

JWT_SECRET  = os.getenv("JWT_SECRET", "change-me-in-dotenv")
ALGORITHM   = "HS256"
EXPIRE_MINS = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))  # 8 hours default

_bearer = HTTPBearer(auto_error=True)


def create_token() -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=EXPIRE_MINS)
    return jwt.encode({"sub": "admin", "exp": expire}, JWT_SECRET, algorithm=ALGORITHM)


def verify_password(plain: str) -> bool:
    stored = os.getenv("ADMIN_PASSWORD_HASH", "")
    if not stored:
        # Fallback: plain-text comparison (dev only)
        return hmac.compare_digest(plain, os.getenv("ADMIN_PASSWORD", ""))
    hashed = hashlib.sha256(plain.encode()).hexdigest()
    return hmac.compare_digest(hashed, stored)


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    try:
        payload = jwt.decode(
            credentials.credentials, JWT_SECRET, algorithms=[ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
