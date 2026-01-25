"""
XTools AI Module - AI-powered features for X/Twitter automation.

This module provides AI capabilities including:
- Content generation (tweets, replies, threads)
- Sentiment analysis
- Spam/bot detection
- Smart targeting recommendations
- Crypto Twitter analysis
- Influencer identification
"""

from __future__ import annotations

from xtools.ai.content_generator import ContentGenerator
from xtools.ai.sentiment_analyzer import SentimentAnalyzer, SentimentResult
from xtools.ai.spam_detector import SpamDetector, BotScore, FollowerQualityReport
from xtools.ai.smart_targeting import SmartTargeting, TargetRecommendation
from xtools.ai.crypto_analyzer import CryptoAnalyzer, TokenSentiment
from xtools.ai.influencer_finder import InfluencerFinder, Influencer

__all__ = [
    "ContentGenerator",
    "SentimentAnalyzer",
    "SentimentResult",
    "SpamDetector",
    "BotScore",
    "FollowerQualityReport",
    "SmartTargeting",
    "TargetRecommendation",
    "CryptoAnalyzer",
    "TokenSentiment",
    "InfluencerFinder",
    "Influencer",
]
