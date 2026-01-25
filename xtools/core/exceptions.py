"""
XTools Exceptions

Custom exception classes for the XTools toolkit.
"""


class XToolsError(Exception):
    """Base exception for all XTools errors."""
    pass


class AuthenticationError(XToolsError):
    """Raised when authentication fails."""
    pass


class RateLimitError(XToolsError):
    """Raised when rate limit is exceeded."""
    pass


class BrowserError(XToolsError):
    """Raised when browser automation fails."""
    pass


class TweetNotFoundError(XToolsError):
    """Raised when a tweet cannot be found."""
    pass


class UserNotFoundError(XToolsError):
    """Raised when a user cannot be found."""
    pass


class ActionFailedError(XToolsError):
    """Raised when an action (like, retweet, etc.) fails."""
    pass


class ConfigurationError(XToolsError):
    """Raised when configuration is invalid."""
    pass


class NetworkError(XToolsError):
    """Raised when network operations fail."""
    pass
