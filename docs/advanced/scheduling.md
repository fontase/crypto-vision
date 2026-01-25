# Background Task Scheduling

Schedule XTools automation tasks to run on a schedule using APScheduler integration.

!!! note "Educational Purpose"
    This documentation is for educational purposes only. Always respect platform terms of service.

## Overview

XTools integrates with APScheduler to run automation tasks on schedules:

- Cron-like scheduling (daily, hourly, etc.)
- Interval-based scheduling
- One-time scheduled tasks
- Job persistence across restarts

## Setup

### Installation

```bash
pip install apscheduler[sqlalchemy] apscheduler[redis]
```

### Basic Configuration

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from xtools import XTools

# Create scheduler
scheduler = AsyncIOScheduler()

# Start scheduler
scheduler.start()

# Shutdown gracefully
import atexit
atexit.register(lambda: scheduler.shutdown())
```

## Scheduling Syntax

### Cron Triggers

```python
from apscheduler.triggers.cron import CronTrigger

# Run at 9 AM every day
CronTrigger(hour=9, minute=0)

# Run at 9 AM on weekdays
CronTrigger(day_of_week='mon-fri', hour=9, minute=0)

# Run every Monday at 6 PM
CronTrigger(day_of_week='mon', hour=18, minute=0)

# Run on the 1st of every month
CronTrigger(day=1, hour=0, minute=0)

# Run every 4 hours
CronTrigger(hour='*/4', minute=0)

# Complex: 9 AM and 6 PM on weekdays
CronTrigger(day_of_week='mon-fri', hour='9,18', minute=0)
```

### Interval Triggers

```python
from apscheduler.triggers.interval import IntervalTrigger

# Every 30 minutes
IntervalTrigger(minutes=30)

# Every 2 hours
IntervalTrigger(hours=2)

# Every day
IntervalTrigger(days=1)

# Every week
IntervalTrigger(weeks=1)
```

### Date Triggers (One-Time)

```python
from apscheduler.triggers.date import DateTrigger
from datetime import datetime, timedelta

# Run at specific time
DateTrigger(run_date=datetime(2024, 12, 25, 9, 0, 0))

# Run in 1 hour
DateTrigger(run_date=datetime.now() + timedelta(hours=1))
```

## Scheduling XTools Tasks

### Daily Follower Report

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from xtools import XTools
from xtools.notifications.discord import DiscordNotifier
import asyncio

scheduler = AsyncIOScheduler()
discord = DiscordNotifier("https://discord.com/api/webhooks/...")

async def daily_follower_report():
    """Generate daily follower report."""
    
    async with XTools() as x:
        await x.auth.load_session("session.json")
        
        # Get current stats
        profile = await x.scrape.profile("your_username")
        
        # Check for changes
        report = await x.monitor.unfollowers()
        
        # Send to Discord
        await discord.send(
            title="📊 Daily Follower Report",
            fields=[
                {"name": "Total Followers", "value": str(profile.followers_count)},
                {"name": "New Followers", "value": str(len(report.new_followers))},
                {"name": "Unfollowers", "value": str(len(report.unfollowers))},
                {"name": "Net Change", "value": f"+{report.net_change}" if report.net_change >= 0 else str(report.net_change)}
            ]
        )

# Schedule for 9 AM daily
scheduler.add_job(
    daily_follower_report,
    CronTrigger(hour=9, minute=0),
    id="daily_follower_report",
    name="Daily Follower Report",
    replace_existing=True
)

scheduler.start()
```

### Hourly Engagement Check

```python
async def hourly_engagement_check():
    """Check engagement on recent tweets."""
    
    async with XTools() as x:
        await x.auth.load_session("session.json")
        
        # Get recent tweets
        tweets = await x.scrape.tweets("your_username", limit=10)
        
        # Calculate engagement
        total_engagement = 0
        for tweet in tweets.items:
            engagement = tweet.likes + tweet.retweets + tweet.replies
            total_engagement += engagement
        
        avg_engagement = total_engagement / len(tweets.items) if tweets.items else 0
        
        # Alert if engagement is low
        if avg_engagement < 10:
            await discord.send(
                title="⚠️ Low Engagement Alert",
                description=f"Average engagement: {avg_engagement:.1f}",
                color=0xFFFF00
            )

# Schedule every hour
scheduler.add_job(
    hourly_engagement_check,
    IntervalTrigger(hours=1),
    id="hourly_engagement",
    name="Hourly Engagement Check"
)
```

### Keyword Monitoring

```python
async def monitor_keywords():
    """Monitor mentions of specific keywords."""
    
    keywords = ["your_brand", "your_product", "competitor"]
    
    async with XTools() as x:
        await x.auth.load_session("session.json")
        
        for keyword in keywords:
            results = await x.scrape.search(
                keyword,
                search_type="Latest",
                limit=20
            )
            
            # Filter to last hour
            recent = [
                t for t in results.items
                if t.created_at > datetime.utcnow() - timedelta(hours=1)
            ]
            
            if recent:
                await discord.send(
                    title=f"🔔 New mentions: {keyword}",
                    description=f"Found {len(recent)} new tweets",
                    fields=[
                        {"name": f"@{t.author_username}", "value": t.text[:100]}
                        for t in recent[:5]
                    ]
                )

# Every 15 minutes
scheduler.add_job(
    monitor_keywords,
    IntervalTrigger(minutes=15),
    id="keyword_monitor",
    name="Keyword Monitor"
)
```

## Job Persistence

### SQLite Persistence

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore

# Configure job store
jobstores = {
    'default': SQLAlchemyJobStore(url='sqlite:///jobs.db')
}

scheduler = AsyncIOScheduler(jobstores=jobstores)

# Jobs are now persisted across restarts
scheduler.add_job(
    daily_follower_report,
    CronTrigger(hour=9),
    id="daily_report",
    replace_existing=True  # Update if exists
)
```

### Redis Persistence

```python
from apscheduler.jobstores.redis import RedisJobStore

jobstores = {
    'default': RedisJobStore(
        host='localhost',
        port=6379,
        db=0
    )
}

scheduler = AsyncIOScheduler(jobstores=jobstores)
```

### PostgreSQL Persistence

```python
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore

jobstores = {
    'default': SQLAlchemyJobStore(
        url='postgresql://user:pass@localhost/xtools'
    )
}

scheduler = AsyncIOScheduler(jobstores=jobstores)
```

## Managing Scheduled Jobs

### List Jobs

```python
def list_jobs():
    """List all scheduled jobs."""
    jobs = scheduler.get_jobs()
    
    for job in jobs:
        print(f"ID: {job.id}")
        print(f"Name: {job.name}")
        print(f"Next run: {job.next_run_time}")
        print(f"Trigger: {job.trigger}")
        print("---")
```

### Pause/Resume Jobs

```python
# Pause a specific job
scheduler.pause_job("daily_report")

# Resume a job
scheduler.resume_job("daily_report")

# Pause all jobs
scheduler.pause()

# Resume all jobs
scheduler.resume()
```

### Modify Jobs

```python
# Reschedule a job
scheduler.reschedule_job(
    "daily_report",
    trigger=CronTrigger(hour=10, minute=30)  # Change to 10:30 AM
)

# Remove a job
scheduler.remove_job("daily_report")

# Remove all jobs
scheduler.remove_all_jobs()
```

### Run Job Immediately

```python
# Trigger job now (in addition to schedule)
job = scheduler.get_job("daily_report")
if job:
    asyncio.create_task(job.func())
```

## Error Handling

### Job Error Handling

```python
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

def job_listener(event):
    """Handle job events."""
    if event.exception:
        print(f"Job {event.job_id} failed: {event.exception}")
        # Send alert
        asyncio.create_task(
            discord.send(
                title="❌ Scheduled Job Failed",
                description=f"Job `{event.job_id}` failed with error:\n```{event.exception}```",
                color=0xFF0000
            )
        )
    else:
        print(f"Job {event.job_id} completed successfully")

scheduler.add_listener(job_listener, EVENT_JOB_ERROR | EVENT_JOB_EXECUTED)
```

### Retry Logic

```python
from functools import wraps

def with_retry(max_retries: int = 3, delay: float = 60):
    """Decorator for retry logic in scheduled tasks."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        await asyncio.sleep(delay * (attempt + 1))
            
            # All retries failed
            await discord.send(
                title=f"❌ Job Failed After {max_retries} Retries",
                description=str(last_error)
            )
            raise last_error
        return wrapper
    return decorator

@with_retry(max_retries=3, delay=60)
async def resilient_task():
    async with XTools() as x:
        await x.auth.load_session("session.json")
        await x.scrape.followers("username", limit=100)
```

### Missed Job Handling

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler(
    job_defaults={
        'coalesce': True,  # Combine missed executions
        'max_instances': 1,  # Only one instance at a time
        'misfire_grace_time': 3600  # Run if within 1 hour of missed time
    }
)
```

## Complete Example

```python
"""
XTools Scheduled Tasks
Run with: python scheduler.py
"""

import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

from xtools import XTools
from xtools.notifications.discord import DiscordNotifier

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DISCORD_WEBHOOK = "https://discord.com/api/webhooks/..."
SESSION_FILE = "session.json"
YOUR_USERNAME = "your_username"

# Initialize
discord = DiscordNotifier(DISCORD_WEBHOOK)

# Job store for persistence
jobstores = {
    'default': SQLAlchemyJobStore(url='sqlite:///xtools_jobs.db')
}

scheduler = AsyncIOScheduler(
    jobstores=jobstores,
    job_defaults={
        'coalesce': True,
        'max_instances': 1,
        'misfire_grace_time': 3600
    }
)


# === Scheduled Tasks ===

async def daily_follower_report():
    """9 AM daily: Full follower report."""
    logger.info("Running daily follower report...")
    
    async with XTools() as x:
        await x.auth.load_session(SESSION_FILE)
        
        profile = await x.scrape.profile(YOUR_USERNAME)
        report = await x.monitor.unfollowers()
        
        await discord.send(
            title="📊 Daily Follower Report",
            fields=[
                {"name": "Followers", "value": str(profile.followers_count), "inline": True},
                {"name": "Following", "value": str(profile.following_count), "inline": True},
                {"name": "New Followers", "value": str(len(report.new_followers)), "inline": True},
                {"name": "Unfollowers", "value": str(len(report.unfollowers)), "inline": True},
            ]
        )


async def hourly_engagement_check():
    """Every hour: Check recent tweet engagement."""
    logger.info("Running hourly engagement check...")
    
    async with XTools() as x:
        await x.auth.load_session(SESSION_FILE)
        
        tweets = await x.scrape.tweets(YOUR_USERNAME, limit=5)
        
        for tweet in tweets.items:
            # Alert on high engagement
            total = tweet.likes + tweet.retweets + tweet.replies
            if total > 100:
                await discord.send(
                    title="🔥 High Engagement Tweet!",
                    description=tweet.text[:200],
                    fields=[
                        {"name": "Likes", "value": str(tweet.likes), "inline": True},
                        {"name": "RTs", "value": str(tweet.retweets), "inline": True},
                        {"name": "Replies", "value": str(tweet.replies), "inline": True},
                    ]
                )


async def weekly_cleanup():
    """Every Monday 6 AM: Unfollow non-followers."""
    logger.info("Running weekly cleanup...")
    
    async with XTools() as x:
        await x.auth.load_session(SESSION_FILE)
        
        # Dry run first to get count
        preview = await x.unfollow.non_followers(dry_run=True)
        
        if len(preview.would_unfollow) > 0:
            # Actually unfollow (with limit)
            result = await x.unfollow.non_followers(
                max_unfollows=50,
                whitelist=["important_friend", "business_partner"]
            )
            
            await discord.send(
                title="🧹 Weekly Cleanup Complete",
                description=f"Unfollowed {len(result.unfollowed_users)} non-followers",
                fields=[
                    {"name": "Users", "value": ", ".join(result.unfollowed_users[:10]) or "None"}
                ]
            )


async def monitor_competitors():
    """Every 4 hours: Check competitor activity."""
    logger.info("Running competitor monitor...")
    
    competitors = ["competitor1", "competitor2"]
    
    async with XTools() as x:
        await x.auth.load_session(SESSION_FILE)
        
        for comp in competitors:
            profile = await x.scrape.profile(comp)
            tweets = await x.scrape.tweets(comp, limit=5)
            
            # Log to database or send alert on significant changes
            logger.info(f"{comp}: {profile.followers_count} followers")


# === Event Handlers ===

def job_error_handler(event):
    """Handle job errors."""
    if event.exception:
        logger.error(f"Job {event.job_id} failed: {event.exception}")
        asyncio.create_task(discord.send(
            title="❌ Scheduled Job Failed",
            description=f"```{event.exception}```",
            color=0xFF0000
        ))

scheduler.add_listener(job_error_handler, EVENT_JOB_ERROR)


# === Job Registration ===

def setup_jobs():
    """Register all scheduled jobs."""
    
    # Daily at 9 AM
    scheduler.add_job(
        daily_follower_report,
        CronTrigger(hour=9, minute=0),
        id="daily_follower_report",
        name="Daily Follower Report",
        replace_existing=True
    )
    
    # Every hour
    scheduler.add_job(
        hourly_engagement_check,
        IntervalTrigger(hours=1),
        id="hourly_engagement",
        name="Hourly Engagement Check",
        replace_existing=True
    )
    
    # Monday 6 AM
    scheduler.add_job(
        weekly_cleanup,
        CronTrigger(day_of_week='mon', hour=6, minute=0),
        id="weekly_cleanup",
        name="Weekly Non-Follower Cleanup",
        replace_existing=True
    )
    
    # Every 4 hours
    scheduler.add_job(
        monitor_competitors,
        CronTrigger(hour='*/4', minute=0),
        id="competitor_monitor",
        name="Competitor Monitor",
        replace_existing=True
    )
    
    logger.info("Scheduled jobs:")
    for job in scheduler.get_jobs():
        logger.info(f"  - {job.name}: next run at {job.next_run_time}")


# === Main ===

async def main():
    """Start the scheduler."""
    setup_jobs()
    scheduler.start()
    
    logger.info("Scheduler started. Press Ctrl+C to exit.")
    
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
```

## Best Practices

!!! tip "Scheduling Tips"
    1. **Use job persistence** - Survive restarts with SQLite/Redis
    2. **Set misfire grace time** - Handle server downtime
    3. **Limit job instances** - Prevent overlapping runs
    4. **Log everything** - Debug scheduling issues
    5. **Use dry runs** - Test jobs before enabling

!!! warning "Rate Limits"
    Schedule tasks with appropriate intervals to respect platform rate limits. Don't run intensive scraping tasks too frequently.

## Next Steps

- [Webhooks](webhooks.md) - Trigger webhooks from scheduled tasks
- [API Server](api-server.md) - Manage schedules via API
- [Error Handling](errors.md) - Handle errors in scheduled tasks
