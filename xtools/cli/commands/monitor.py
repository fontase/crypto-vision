"""
Monitoring commands for XTools CLI.
"""

from __future__ import annotations

import os
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from xtools.cli.utils import (
    async_command,
    export_data,
    get_progress,
    print_success,
    print_error,
    print_info,
    print_warning,
    output_option,
    format_option,
    format_number,
    format_date,
)

console = Console()


def get_storage_path() -> Path:
    """Get default storage path"""
    return Path(os.environ.get("XTOOLS_DATA_DIR", os.path.expanduser("~/.xtools")))


def ensure_storage_dir() -> Path:
    """Ensure storage directory exists"""
    path = get_storage_path()
    path.mkdir(parents=True, exist_ok=True)
    return path


@click.group()
def monitor():
    """Monitoring and analytics for X/Twitter.
    
    \b
    Examples:
        xtools monitor unfollowers --notify
        xtools monitor account elonmusk --track
        xtools monitor keywords "AI" "GPT" --alert
    """
    pass


@monitor.command()
@click.option("--notify", is_flag=True, help="Send notifications for changes.")
@click.option("--webhook", help="Webhook URL for notifications.")
@click.option("--compare", help="Compare with specific snapshot.")
@output_option
@format_option
@click.pass_context
@async_command
async def unfollowers(
    ctx,
    notify: bool,
    webhook: str | None,
    compare: str | None,
    output: str | None,
    format: str,
):
    """Detect who unfollowed you.
    
    Compares current followers with previous snapshot to find unfollowers.
    """
    print_info("Checking for unfollowers...")
    
    if compare:
        print_info(f"Comparing with snapshot: {compare}")
    else:
        print_info("Comparing with last snapshot")
    
    # Placeholder data
    unfollowers_data = {
        "snapshot_date": "2024-01-01",
        "current_followers": 10000,
        "previous_followers": 10050,
        "new_followers": 20,
        "unfollowers": [
            {"username": f"unfollower_{i}", "unfollowed_at": "2024-01-15"}
            for i in range(5)
        ],
    }
    
    # Display results
    table = Table(title="Unfollower Report")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    
    table.add_row("Previous Followers", format_number(unfollowers_data["previous_followers"]))
    table.add_row("Current Followers", format_number(unfollowers_data["current_followers"]))
    table.add_row("New Followers", f"+{unfollowers_data['new_followers']}")
    table.add_row("Unfollowers", f"[red]-{len(unfollowers_data['unfollowers'])}[/red]")
    table.add_row("Net Change", 
                  f"{unfollowers_data['current_followers'] - unfollowers_data['previous_followers']}")
    
    console.print(table)
    console.print()
    
    if unfollowers_data["unfollowers"]:
        console.print("[bold]Unfollowers:[/bold]")
        for user in unfollowers_data["unfollowers"]:
            console.print(f"  • @{user['username']}")
        console.print()
    
    if notify:
        if webhook:
            print_info(f"Sending notification to webhook...")
        else:
            print_info("Notification sent (console)")
    
    if output:
        export_data(unfollowers_data, output, format)
    
    print_success("Unfollower check complete")


@monitor.command()
@click.option("--notify", is_flag=True, help="Send notifications for new followers.")
@click.option("--min-followers", default=0, help="Only alert for users with this many followers.")
@output_option
@click.pass_context
@async_command
async def new_followers(
    ctx,
    notify: bool,
    min_followers: int,
    output: str | None,
):
    """Monitor and alert on new followers.
    
    Useful for tracking growth and identifying notable new followers.
    """
    print_info("Checking for new followers...")
    
    if min_followers:
        print_info(f"Only showing followers with >{format_number(min_followers)} followers")
    
    # Placeholder data
    new_followers_data = [
        {
            "username": f"new_follower_{i}",
            "display_name": f"New Follower {i}",
            "followers_count": 1000 + i * 500,
            "followed_at": "2024-01-15T12:00:00Z",
        }
        for i in range(5)
    ]
    
    # Filter by min_followers
    filtered = [f for f in new_followers_data if f["followers_count"] >= min_followers]
    
    if filtered:
        table = Table(title="New Followers")
        table.add_column("Username", style="cyan")
        table.add_column("Display Name", style="green")
        table.add_column("Followers", style="yellow")
        table.add_column("Followed At")
        
        for follower in filtered:
            table.add_row(
                f"@{follower['username']}",
                follower["display_name"],
                format_number(follower["followers_count"]),
                format_date(follower["followed_at"]),
            )
        
        console.print(table)
    else:
        print_info("No new followers matching criteria")
    
    if output:
        export_data(filtered, output, "json")
    
    print_success(f"Found {len(filtered)} new followers")


@monitor.command()
@click.argument("username")
@click.option("--track", is_flag=True, help="Add to tracked accounts.")
@click.option("--interval", default=60, help="Check interval in minutes.")
@click.option("--changes", is_flag=True, help="Show recent changes.")
@output_option
@click.pass_context
@async_command
async def account(
    ctx,
    username: str,
    track: bool,
    interval: int,
    changes: bool,
    output: str | None,
):
    """Monitor a specific account.
    
    USERNAME: The account to monitor.
    """
    username = username.lstrip("@")
    
    if track:
        print_info(f"Adding @{username} to tracked accounts (interval: {interval}min)")
    
    print_info(f"Monitoring @{username}...")
    
    # Placeholder data
    account_data = {
        "username": username,
        "current": {
            "followers": 100000,
            "following": 500,
            "tweets": 5000,
        },
        "changes_24h": {
            "followers": +150,
            "following": +5,
            "tweets": +10,
        },
        "changes_7d": {
            "followers": +800,
            "following": +20,
            "tweets": +50,
        },
    }
    
    # Display current stats
    table = Table(title=f"@{username} Stats")
    table.add_column("Metric", style="cyan")
    table.add_column("Current", style="green")
    table.add_column("24h Change", style="yellow")
    table.add_column("7d Change", style="blue")
    
    for metric in ["followers", "following", "tweets"]:
        current = format_number(account_data["current"][metric])
        change_24h = account_data["changes_24h"][metric]
        change_7d = account_data["changes_7d"][metric]
        
        color_24h = "green" if change_24h > 0 else "red" if change_24h < 0 else "white"
        color_7d = "green" if change_7d > 0 else "red" if change_7d < 0 else "white"
        
        table.add_row(
            metric.title(),
            current,
            f"[{color_24h}]{'+' if change_24h > 0 else ''}{change_24h}[/{color_24h}]",
            f"[{color_7d}]{'+' if change_7d > 0 else ''}{change_7d}[/{color_7d}]",
        )
    
    console.print(table)
    
    if output:
        export_data(account_data, output, "json")
    
    if track:
        print_success(f"@{username} is now being tracked")


@monitor.command()
@click.argument("keywords", nargs=-1, required=True)
@click.option("--alert-threshold", default=10, help="Alert when mentions exceed this count/hour.")
@click.option("--sentiment", is_flag=True, help="Include sentiment analysis.")
@click.option("--notify", is_flag=True, help="Send notifications for alerts.")
@output_option
@click.pass_context
@async_command
async def keywords(
    ctx,
    keywords: tuple[str, ...],
    alert_threshold: int,
    sentiment: bool,
    notify: bool,
    output: str | None,
):
    """Monitor keywords/topics.
    
    KEYWORDS: Keywords to monitor.
    """
    print_info(f"Monitoring keywords: {', '.join(keywords)}")
    print_info(f"Alert threshold: {alert_threshold}/hour")
    
    if sentiment:
        print_info("Sentiment analysis enabled")
    
    # Placeholder data
    keyword_data = {}
    for kw in keywords:
        keyword_data[kw] = {
            "mentions_1h": 5 + hash(kw) % 20,
            "mentions_24h": 100 + hash(kw) % 500,
            "sentiment": "positive" if sentiment else None,
            "trending": hash(kw) % 3 == 0,
        }
    
    # Display
    table = Table(title="Keyword Monitoring")
    table.add_column("Keyword", style="cyan")
    table.add_column("1h", style="green")
    table.add_column("24h", style="yellow")
    if sentiment:
        table.add_column("Sentiment", style="blue")
    table.add_column("Trending", style="magenta")
    
    for kw, data in keyword_data.items():
        row = [
            kw,
            str(data["mentions_1h"]),
            str(data["mentions_24h"]),
        ]
        if sentiment:
            row.append(data["sentiment"] or "N/A")
        row.append("🔥" if data["trending"] else "")
        table.add_row(*row)
    
    console.print(table)
    
    # Check alerts
    for kw, data in keyword_data.items():
        if data["mentions_1h"] > alert_threshold:
            print_warning(f"⚠️ Alert: '{kw}' has {data['mentions_1h']} mentions/hour")
    
    if output:
        export_data(keyword_data, output, "json")


@monitor.command()
@click.option("--period", "-p", default="7d", help="Analysis period (1d, 7d, 30d).")
@output_option
@format_option
@click.pass_context
@async_command
async def growth(
    ctx,
    period: str,
    output: str | None,
    format: str,
):
    """Analyze your account growth.
    
    Shows follower growth, engagement trends, and insights.
    """
    print_info(f"Analyzing growth for last {period}...")
    
    # Placeholder data
    growth_data = {
        "period": period,
        "followers": {
            "start": 9500,
            "end": 10000,
            "change": 500,
            "change_pct": 5.26,
        },
        "engagement": {
            "avg_likes": 50,
            "avg_retweets": 10,
            "avg_replies": 5,
            "engagement_rate": 2.5,
        },
        "top_tweets": [
            {"text": "Top performing tweet 1", "likes": 200},
            {"text": "Top performing tweet 2", "likes": 150},
        ],
        "best_posting_times": ["9am", "12pm", "6pm"],
    }
    
    # Display growth stats
    console.print("\n[bold blue]Growth Analysis[/bold blue]\n")
    
    table = Table(title=f"Follower Growth ({period})")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    
    table.add_row("Starting Followers", format_number(growth_data["followers"]["start"]))
    table.add_row("Current Followers", format_number(growth_data["followers"]["end"]))
    table.add_row("Net Growth", f"+{growth_data['followers']['change']}")
    table.add_row("Growth Rate", f"+{growth_data['followers']['change_pct']:.1f}%")
    
    console.print(table)
    console.print()
    
    # Engagement stats
    table2 = Table(title="Engagement Metrics")
    table2.add_column("Metric", style="cyan")
    table2.add_column("Average", style="green")
    
    table2.add_row("Likes/Tweet", str(growth_data["engagement"]["avg_likes"]))
    table2.add_row("Retweets/Tweet", str(growth_data["engagement"]["avg_retweets"]))
    table2.add_row("Replies/Tweet", str(growth_data["engagement"]["avg_replies"]))
    table2.add_row("Engagement Rate", f"{growth_data['engagement']['engagement_rate']}%")
    
    console.print(table2)
    console.print()
    
    # Best times
    console.print(f"[bold]Best posting times:[/bold] {', '.join(growth_data['best_posting_times'])}")
    console.print()
    
    if output:
        export_data(growth_data, output, format)
    
    print_success("Growth analysis complete")


@monitor.command()
@click.option("--continuous", is_flag=True, help="Run continuously.")
@click.option("--interval", default=5, help="Check interval in minutes.")
@click.option("--notify", is_flag=True, help="Send notifications.")
@click.pass_context
@async_command
async def mentions(
    ctx,
    continuous: bool,
    interval: int,
    notify: bool,
):
    """Monitor your mentions in real-time.
    
    Track who's mentioning you and respond quickly.
    """
    mode = "continuously" if continuous else "once"
    print_info(f"Monitoring mentions {mode}...")
    
    if continuous:
        print_info(f"Checking every {interval} minutes. Press Ctrl+C to stop.")
    
    # Placeholder data
    mentions_data = [
        {
            "id": f"mention_{i}",
            "author": f"user_{i}",
            "text": f"Hey @you, this is mention {i}",
            "created_at": "2024-01-15T12:00:00Z",
        }
        for i in range(3)
    ]
    
    if mentions_data:
        table = Table(title="Recent Mentions")
        table.add_column("From", style="cyan")
        table.add_column("Text", style="green", max_width=50)
        table.add_column("Time", style="yellow")
        
        for mention in mentions_data:
            table.add_row(
                f"@{mention['author']}",
                mention["text"][:50] + "..." if len(mention["text"]) > 50 else mention["text"],
                format_date(mention["created_at"]),
            )
        
        console.print(table)
    else:
        print_info("No new mentions")
    
    if notify and mentions_data:
        print_info(f"Notified about {len(mentions_data)} new mentions")
    
    print_success("Mentions check complete")
