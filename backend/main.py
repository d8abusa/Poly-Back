"""
PolyBack — FastAPI backend
Run: uvicorn backend.main:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import markets, backtest, strategies, signals, positions, feed, settings

app = FastAPI(
    title="PolyBack API",
    description="Polymarket backtesting and market search API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(markets.router)
app.include_router(backtest.router)
app.include_router(strategies.router)
app.include_router(signals.router)
app.include_router(positions.router)
app.include_router(feed.router)
app.include_router(settings.router)


@app.get("/")
async def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
