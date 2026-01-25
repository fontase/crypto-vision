# FastAPI REST API Server

Build a production-ready REST API server to expose XTools functionality over HTTP.

!!! note "Educational Purpose"
    This documentation is for educational purposes only. Always respect platform terms of service.

## Overview

XTools includes a built-in FastAPI server for remote access to scraping and automation features.

```mermaid
flowchart LR
    A[Client] --> B[FastAPI Server]
    B --> C[Authentication]
    C --> D[Rate Limiter]
    D --> E[XTools]
    E --> F[Browser Pool]
```

## Quick Start

### Starting the Server

=== "CLI"
    ```bash
    xtools serve --host 0.0.0.0 --port 8000
    ```

=== "Python"
    ```python
    from xtools.api.server import create_app
    import uvicorn
    
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)
    ```

=== "With Config"
    ```python
    from xtools.api.server import create_app
    from xtools.core.config import Config
    
    config = Config(
        api={
            "host": "0.0.0.0",
            "port": 8000,
            "workers": 4,
            "cors_origins": ["https://myapp.com"]
        }
    )
    
    app = create_app(config)
    ```

## Authentication

### API Key Authentication

```python
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.security import APIKeyHeader
import os

api_key_header = APIKeyHeader(name="X-API-Key")

def get_api_key(api_key: str = Depends(api_key_header)) -> str:
    """Validate API key."""
    valid_keys = os.getenv("API_KEYS", "").split(",")
    
    if api_key not in valid_keys:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )
    
    return api_key

# Apply to routes
@app.get("/api/profile/{username}")
async def get_profile(
    username: str,
    api_key: str = Depends(get_api_key)
):
    # Authenticated endpoint
    pass
```

### JWT Authentication

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from datetime import datetime, timedelta
from pydantic import BaseModel

SECRET_KEY = os.getenv("JWT_SECRET")
ALGORITHM = "HS256"

security = HTTPBearer()

class TokenData(BaseModel):
    user_id: str
    scopes: list[str] = []

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """Create JWT token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=24))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> TokenData:
    """Validate JWT and return user data."""
    
    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )
        return TokenData(
            user_id=payload.get("sub"),
            scopes=payload.get("scopes", [])
        )
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )

def require_scope(scope: str):
    """Require specific scope."""
    def checker(user: TokenData = Depends(get_current_user)):
        if scope not in user.scopes:
            raise HTTPException(
                status_code=403,
                detail=f"Scope '{scope}' required"
            )
        return user
    return checker

# Usage
@app.get("/api/scrape/followers")
async def scrape_followers(
    username: str,
    user: TokenData = Depends(require_scope("scrape:read"))
):
    pass

@app.post("/api/actions/follow")
async def follow_user(
    target: str,
    user: TokenData = Depends(require_scope("actions:write"))
):
    pass
```

## Available Endpoints

### Scraping Endpoints

```python
from fastapi import FastAPI, Query, BackgroundTasks
from pydantic import BaseModel, HttpUrl
from typing import Optional, List
from xtools import XTools

app = FastAPI(title="XTools API", version="2.0.0")

# Global XTools instance pool
xtools_pool = None

@app.on_event("startup")
async def startup():
    global xtools_pool
    xtools_pool = await XToolsPool.create(size=4)

@app.on_event("shutdown")
async def shutdown():
    await xtools_pool.close()

class ScrapeResponse(BaseModel):
    success: bool
    items: List[dict]
    total: int
    has_more: bool
    cursor: Optional[str] = None

@app.get("/api/scrape/profile/{username}", response_model=dict)
async def scrape_profile(username: str):
    """Scrape user profile information."""
    async with xtools_pool.acquire() as x:
        result = await x.scrape.profile(username)
        return result.dict()

@app.get("/api/scrape/followers/{username}", response_model=ScrapeResponse)
async def scrape_followers(
    username: str,
    limit: int = Query(100, ge=1, le=5000),
    cursor: Optional[str] = None
):
    """Scrape user's followers."""
    async with xtools_pool.acquire() as x:
        result = await x.scrape.followers(
            username,
            limit=limit,
            cursor=cursor
        )
        return ScrapeResponse(
            success=True,
            items=[f.dict() for f in result.items],
            total=result.total_scraped,
            has_more=result.has_more,
            cursor=result.cursor
        )

@app.get("/api/scrape/tweets/{username}", response_model=ScrapeResponse)
async def scrape_tweets(
    username: str,
    limit: int = Query(100, ge=1, le=1000),
    include_retweets: bool = True
):
    """Scrape user's tweets."""
    async with xtools_pool.acquire() as x:
        result = await x.scrape.tweets(
            username,
            limit=limit,
            include_retweets=include_retweets
        )
        return ScrapeResponse(
            success=True,
            items=[t.dict() for t in result.items],
            total=result.total_scraped,
            has_more=result.has_more
        )

@app.get("/api/scrape/replies")
async def scrape_replies(
    tweet_url: HttpUrl,
    limit: int = Query(100, ge=1, le=500)
):
    """Scrape tweet replies."""
    async with xtools_pool.acquire() as x:
        result = await x.scrape.replies(str(tweet_url), limit=limit)
        return {
            "success": True,
            "items": [r.dict() for r in result.items],
            "total": result.total_scraped
        }

@app.get("/api/scrape/search")
async def search_tweets(
    query: str,
    search_type: str = Query("Latest", regex="^(Top|Latest|People|Media)$"),
    limit: int = Query(100, ge=1, le=500)
):
    """Search tweets."""
    async with xtools_pool.acquire() as x:
        result = await x.scrape.search(
            query,
            search_type=search_type,
            limit=limit
        )
        return {
            "success": True,
            "items": [t.dict() for t in result.items],
            "total": result.total_scraped
        }
```

### Action Endpoints

```python
class ActionRequest(BaseModel):
    target: str

class FollowResponse(BaseModel):
    success: bool
    username: str

class UnfollowRequest(BaseModel):
    max_unfollows: int = 100
    whitelist: List[str] = []
    dry_run: bool = False

@app.post("/api/actions/follow", response_model=FollowResponse)
async def follow_user(request: ActionRequest):
    """Follow a user."""
    async with xtools_pool.acquire() as x:
        success = await x.follow.user(request.target)
        return FollowResponse(success=success, username=request.target)

@app.post("/api/actions/unfollow", response_model=FollowResponse)
async def unfollow_user(request: ActionRequest):
    """Unfollow a user."""
    async with xtools_pool.acquire() as x:
        success = await x.unfollow.user(request.target)
        return FollowResponse(success=success, username=request.target)

@app.post("/api/actions/unfollow-non-followers")
async def unfollow_non_followers(
    request: UnfollowRequest,
    background_tasks: BackgroundTasks
):
    """Unfollow users who don't follow back."""
    
    # Run in background for long operations
    task_id = str(uuid.uuid4())
    background_tasks.add_task(
        run_unfollow_task,
        task_id,
        request
    )
    
    return {
        "task_id": task_id,
        "status": "started",
        "message": "Check /api/tasks/{task_id} for progress"
    }

@app.post("/api/actions/like")
async def like_tweet(tweet_url: HttpUrl):
    """Like a tweet."""
    async with xtools_pool.acquire() as x:
        success = await x.engage.like(str(tweet_url))
        return {"success": success}

@app.post("/api/actions/retweet")
async def retweet(tweet_url: HttpUrl):
    """Retweet a tweet."""
    async with xtools_pool.acquire() as x:
        success = await x.engage.retweet(str(tweet_url))
        return {"success": success}
```

### Background Tasks

```python
from typing import Dict
import uuid

# Task storage (use Redis in production)
tasks: Dict[str, dict] = {}

async def run_unfollow_task(task_id: str, request: UnfollowRequest):
    """Run unfollow operation in background."""
    
    tasks[task_id] = {
        "status": "running",
        "progress": 0,
        "result": None
    }
    
    try:
        async with xtools_pool.acquire() as x:
            result = await x.unfollow.non_followers(
                max_unfollows=request.max_unfollows,
                whitelist=request.whitelist,
                dry_run=request.dry_run,
                progress_callback=lambda p: update_progress(task_id, p)
            )
            
            tasks[task_id] = {
                "status": "completed",
                "progress": 100,
                "result": {
                    "unfollowed": result.unfollowed_users,
                    "count": len(result.unfollowed_users)
                }
            }
    except Exception as e:
        tasks[task_id] = {
            "status": "failed",
            "error": str(e)
        }

def update_progress(task_id: str, progress: int):
    if task_id in tasks:
        tasks[task_id]["progress"] = progress

@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    """Get background task status."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]
```

## Rate Limiting

### In-Memory Rate Limiter

```python
from fastapi import Request
from collections import defaultdict
import time

class RateLimiter:
    def __init__(self, requests_per_minute: int = 60):
        self.rpm = requests_per_minute
        self.requests = defaultdict(list)
    
    def is_allowed(self, key: str) -> bool:
        now = time.time()
        minute_ago = now - 60
        
        # Clean old requests
        self.requests[key] = [
            t for t in self.requests[key] if t > minute_ago
        ]
        
        if len(self.requests[key]) >= self.rpm:
            return False
        
        self.requests[key].append(now)
        return True
    
    def get_retry_after(self, key: str) -> int:
        if not self.requests[key]:
            return 0
        oldest = min(self.requests[key])
        return max(0, int(60 - (time.time() - oldest)))

rate_limiter = RateLimiter(requests_per_minute=60)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Use API key or IP as rate limit key
    key = request.headers.get("X-API-Key") or request.client.host
    
    if not rate_limiter.is_allowed(key):
        return JSONResponse(
            status_code=429,
            content={
                "detail": "Rate limit exceeded",
                "retry_after": rate_limiter.get_retry_after(key)
            },
            headers={"Retry-After": str(rate_limiter.get_retry_after(key))}
        )
    
    return await call_next(request)
```

### Redis Rate Limiter

```python
import redis.asyncio as redis

class RedisRateLimiter:
    def __init__(self, redis_url: str, requests_per_minute: int = 60):
        self.redis_url = redis_url
        self.rpm = requests_per_minute
    
    async def is_allowed(self, key: str) -> bool:
        async with redis.from_url(self.redis_url) as r:
            pipe = r.pipeline()
            now = time.time()
            window_key = f"ratelimit:{key}"
            
            # Add current request
            pipe.zadd(window_key, {str(now): now})
            # Remove old entries
            pipe.zremrangebyscore(window_key, 0, now - 60)
            # Count requests
            pipe.zcard(window_key)
            # Set expiry
            pipe.expire(window_key, 60)
            
            results = await pipe.execute()
            count = results[2]
            
            return count <= self.rpm
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers
RUN playwright install chromium
RUN playwright install-deps chromium

# Copy application
COPY . .

# Create non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run server
CMD ["uvicorn", "xtools.api.server:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  xtools-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - API_KEYS=${API_KEYS}
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./sessions:/app/sessions
    depends_on:
      - redis
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 2G
    restart: unless-stopped
  
  redis:
    image: redis:alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

## OpenAPI Documentation

XTools API automatically generates OpenAPI documentation:

```python
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

app = FastAPI(
    title="XTools API",
    description="REST API for X/Twitter automation",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title="XTools API",
        version="2.0.0",
        description="Educational X/Twitter automation API",
        routes=app.routes,
    )
    
    # Add security schemes
    openapi_schema["components"]["securitySchemes"] = {
        "APIKeyHeader": {
            "type": "apiKey",
            "in": "header",
            "name": "X-API-Key"
        },
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT"
        }
    }
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi
```

Access documentation at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Complete Server Example

```python
"""
XTools REST API Server
Run with: uvicorn server:app --reload
"""

from fastapi import FastAPI, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, HttpUrl
from typing import Optional, List
from contextlib import asynccontextmanager
import os

from xtools import XTools

# Lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.xtools = await XTools().__aenter__()
    await app.state.xtools.auth.load_session("session.json")
    yield
    # Shutdown
    await app.state.xtools.__aexit__(None, None, None)

app = FastAPI(
    title="XTools API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth
api_key_header = APIKeyHeader(name="X-API-Key")

async def verify_api_key(api_key: str = Depends(api_key_header)):
    if api_key not in os.getenv("API_KEYS", "").split(","):
        raise HTTPException(status_code=401)
    return api_key

# Health check
@app.get("/health")
async def health():
    return {"status": "healthy"}

# Endpoints
@app.get("/api/profile/{username}")
async def get_profile(
    username: str,
    _: str = Depends(verify_api_key)
):
    result = await app.state.xtools.scrape.profile(username)
    return result.dict()

@app.get("/api/followers/{username}")
async def get_followers(
    username: str,
    limit: int = Query(100, le=1000),
    _: str = Depends(verify_api_key)
):
    result = await app.state.xtools.scrape.followers(username, limit=limit)
    return {
        "items": [f.dict() for f in result.items],
        "total": result.total_scraped
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## Best Practices

!!! tip "API Best Practices"
    1. **Always authenticate** - Use API keys or JWT
    2. **Rate limit aggressively** - Protect your XTools sessions
    3. **Use background tasks** - Don't block on long operations
    4. **Pool XTools instances** - Reuse browser sessions
    5. **Document everything** - Keep OpenAPI schema updated

!!! warning "Security"
    Never expose the API publicly without authentication. Use HTTPS in production.

## Next Steps

- [Scheduling](scheduling.md) - Schedule API-triggered tasks
- [Webhooks](webhooks.md) - Send API results via webhooks
- [Error Handling](errors.md) - Handle API errors properly
