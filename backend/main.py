import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes import markets, backtest, strategies, signals, positions, feed, settings, watchlist, scanner
from backend import cron_routes as cron
from backend.services.stop_loss_executor import run_stop_loss_loop
from backend.services.drawdown_monitor import drawdown_monitor

try:
    from backend.routes import admin
    _has_admin = True
except ImportError:
    _has_admin = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    task_drawdown  = asyncio.create_task(drawdown_monitor.monitor_drawdown())
    task_stop_loss = asyncio.create_task(run_stop_loss_loop())
    yield
    task_drawdown.cancel()
    task_stop_loss.cancel()
    try:
        await task_drawdown
        await task_stop_loss
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="PolyBack API",
    description="Polymarket backtesting and market search API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
app.include_router(watchlist.router)
app.include_router(cron.router)
app.include_router(scanner.router)

if _has_admin:
    app.include_router(admin.router)


@app.get("/")
async def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
