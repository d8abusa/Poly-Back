import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes import markets, backtest, strategies, signals, positions, feed, settings, watchlist, scanner, fred as fred_routes
from backend.routes import auth as auth_routes, ops as ops_routes
from backend import cron_routes as cron
from backend.services.stop_loss_executor import run_stop_loss_loop
from backend.services.drawdown_monitor import drawdown_monitor
from backend.services.alert_monitor import run_alert_monitor
from backend.services.fred_scheduler import run_fred_scheduler, _trigger_once as fred_trigger_once
from backend.services.job_registry import registry
from backend.routes.ops import register_trigger
from backend.middleware.auth import require_auth

# Register one-shot triggers for jobs that support manual fire
register_trigger("fred_auto_refresh", fred_trigger_once)

try:
    from backend.routes import admin
    _has_admin = True
except ImportError:
    _has_admin = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(drawdown_monitor.monitor_drawdown()),
        asyncio.create_task(run_stop_loss_loop()),
        asyncio.create_task(run_alert_monitor()),
        asyncio.create_task(run_fred_scheduler()),
    ]
    # Attach tasks to registry so catalog can report live health
    registry.attach_task("drawdown_monitor",  tasks[0])
    registry.attach_task("stop_loss_executor", tasks[1])
    registry.attach_task("alert_monitor",      tasks[2])
    registry.attach_task("fred_auto_refresh",  tasks[3])
    yield
    for t in tasks:
        t.cancel()
    try:
        await asyncio.gather(*tasks, return_exceptions=True)
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
    allow_origins=[
        "http://localhost:5173",  "https://localhost:5173",
        "http://localhost:3000",  "https://localhost:3000",
        "https://10.0.0.46:5173", "https://10.0.0.46:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth route is public (no token needed)
app.include_router(auth_routes.router)

# All other API routers require a valid JWT
_auth = [Depends(require_auth)]
app.include_router(markets.router,    dependencies=_auth)
app.include_router(backtest.router,   dependencies=_auth)
app.include_router(strategies.router, dependencies=_auth)
app.include_router(signals.router,    dependencies=_auth)
app.include_router(positions.router,  dependencies=_auth)
app.include_router(feed.router,       dependencies=_auth)
app.include_router(settings.router,   dependencies=_auth)
app.include_router(watchlist.router,  dependencies=_auth)
app.include_router(cron.router,        dependencies=_auth)
app.include_router(scanner.router,     dependencies=_auth)
app.include_router(fred_routes.router, dependencies=_auth)
app.include_router(ops_routes.router,  dependencies=_auth)

if _has_admin:
    app.include_router(admin.router, dependencies=_auth)


@app.get("/")
async def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
