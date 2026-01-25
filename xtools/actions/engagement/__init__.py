"""
XTools Engagement Module

Contains all engagement automation features:
- Likes (single, by keyword, by user, by hashtag, auto-liker)
- Comments (reply, auto-commenter, AI commenter)
- Retweets (single, quote tweet, auto-retweet)
- Bookmarks (add, remove, export)
"""

from xtools.actions.engagement.like import (
    LikeTweet,
    LikeByKeyword,
    LikeByUser,
    LikeByHashtag,
    AutoLiker,
)
from xtools.actions.engagement.comment import (
    ReplyTweet,
    AutoCommenter,
    AICommenter,
)
from xtools.actions.engagement.retweet import (
    RetweetTweet,
    QuoteTweet,
    AutoRetweet,
)
from xtools.actions.engagement.bookmark import (
    BookmarkTweet,
    RemoveBookmark,
    ExportBookmarks,
    BookmarkManager,
)

__all__ = [
    # Like actions
    "LikeTweet",
    "LikeByKeyword",
    "LikeByUser",
    "LikeByHashtag",
    "AutoLiker",
    # Comment actions
    "ReplyTweet",
    "AutoCommenter",
    "AICommenter",
    # Retweet actions
    "RetweetTweet",
    "QuoteTweet",
    "AutoRetweet",
    # Bookmark actions
    "BookmarkTweet",
    "RemoveBookmark",
    "ExportBookmarks",
    "BookmarkManager",
]
