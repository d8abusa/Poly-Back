from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..middleware.auth import create_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest):
    if not verify_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
        )
    return {"access_token": create_token(), "token_type": "bearer"}
