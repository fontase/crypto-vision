"""
XTools - X/Twitter Automation Toolkit

A comprehensive Python toolkit for X/Twitter scraping and automation
using browser automation (Playwright).
"""

__version__ = "0.1.0"
__author__ = "XTools Team"

from xtools.core.browser import BrowserManager
from xtools.core.auth import AuthManager
from xtools.core.rate_limiter import RateLimiter
from xtools.core.config import Config
from xtools.core.exceptions import XToolsError

# Storage
from xtools.storage import Database, FollowTracker

# Follow Actions
from xtools.actions.follow import (
    FollowUser,
    FollowByKeyword,
    FollowByHashtag,
    FollowTargetFollowers,
    FollowEngagers,
    AutoFollow,
)

# Unfollow Actions
from xtools.actions.unfollow import (
    UnfollowUser,
    UnfollowUsers,
    UnfollowAll,
    UnfollowNonFollowers,
    SmartUnfollow,
    UnfollowByCriteria,
)

# Base classes and utilities
from xtools.actions.base import (
    BaseAction,
    FollowResult,
    UnfollowResult,
    FollowFilters,
    UnfollowFilters,
    ActionStats,
)

__all__ = [
    # Core
    "BrowserManager",
    "AuthManager", 
    "RateLimiter",
    "Config",
    "XToolsError",
    # Storage
    "Database",
    "FollowTracker",
    # Follow Actions
    "FollowUser",
    "FollowByKeyword",
    "FollowByHashtag",
    "FollowTargetFollowers",
    "FollowEngagers",
    "AutoFollow",
    # Unfollow Actions
    "UnfollowUser",
    "UnfollowUsers",
    "UnfollowAll",
    "UnfollowNonFollowers",
    "SmartUnfollow",
    "UnfollowByCriteria",
    # Base classes
    "BaseAction",
    "FollowResult",
    "UnfollowResult",
    "FollowFilters",
    "UnfollowFilters",
    "ActionStats",
]
