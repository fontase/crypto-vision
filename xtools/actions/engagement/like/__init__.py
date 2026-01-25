"""
XTools Like Module

Provides all like-related automation features.
"""

from xtools.actions.engagement.like.like_tweet import LikeTweet
from xtools.actions.engagement.like.like_by_keyword import LikeByKeyword
from xtools.actions.engagement.like.like_by_user import LikeByUser
from xtools.actions.engagement.like.like_by_hashtag import LikeByHashtag
from xtools.actions.engagement.like.auto_liker import AutoLiker

__all__ = [
    "LikeTweet",
    "LikeByKeyword",
    "LikeByUser",
    "LikeByHashtag",
    "AutoLiker",
]
