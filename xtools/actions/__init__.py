"""
Actions module for xtools.

Provides follow and unfollow operations for X/Twitter automation.
"""

from .base import (
    BaseAction,
    ActionResult,
    ActionStats,
    FollowResult,
    UnfollowResult,
    FollowFilters,
    RateLimiter,
    BrowserManager,
)

__all__ = [
    'BaseAction',
    'ActionResult',
    'ActionStats',
    'FollowResult',
    'UnfollowResult',
    'FollowFilters',
    'RateLimiter',
    'BrowserManager',
]
