# Building Custom Scrapers

Learn how to extend XTools by building custom scrapers that integrate seamlessly with the framework.

!!! note "Educational Purpose"
    This documentation is for educational purposes only. Always respect platform terms of service.

## Understanding BaseScraper

All XTools scrapers inherit from `BaseScraper`, which provides common functionality for browser interaction, pagination, and error handling.

```python
from xtools.scrapers.base import BaseScraper
from xtools.models.base import BaseModel
from typing import AsyncGenerator, Optional
from pydantic import Field

class BaseScraper:
    """Base class for all XTools scrapers."""
    
    def __init__(self, browser_manager):
        self.browser = browser_manager
        self.page = None
    
    async def scrape(self, *args, **kwargs) -> "ScrapeResult":
        """Main entry point - override this."""
        raise NotImplementedError
    
    async def _extract_data(self, element) -> dict:
        """Extract data from a page element."""
        raise NotImplementedError
    
    async def _handle_pagination(self, cursor: Optional[str] = None):
        """Handle infinite scroll or cursor-based pagination."""
        raise NotImplementedError
```

## Creating a Custom Scraper

### Step 1: Define Your Data Model

First, create a Pydantic model for your scraped data:

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class Bookmark(BaseModel):
    """Model for a bookmarked tweet."""
    
    tweet_id: str = Field(..., description="Unique tweet ID")
    author_username: str = Field(..., description="Tweet author's username")
    author_name: str = Field(..., description="Tweet author's display name")
    text: str = Field(..., description="Tweet content")
    bookmarked_at: Optional[datetime] = Field(None, description="When bookmarked")
    likes: int = Field(0, description="Like count")
    retweets: int = Field(0, description="Retweet count")
    replies: int = Field(0, description="Reply count")
    media_urls: List[str] = Field(default_factory=list, description="Media URLs")

class BookmarksResult(BaseModel):
    """Result container for bookmarks scraping."""
    
    items: List[Bookmark] = Field(default_factory=list)
    cursor: Optional[str] = None
    total_scraped: int = 0
    has_more: bool = False
```

### Step 2: Implement the Scraper Class

```python
from xtools.scrapers.base import BaseScraper
from xtools.core.exceptions import ScraperError, RateLimitError
from typing import Optional, List
import asyncio

class BookmarksScraper(BaseScraper):
    """Scraper for user's bookmarked tweets."""
    
    BOOKMARKS_URL = "https://x.com/i/bookmarks"
    
    def __init__(self, browser_manager):
        super().__init__(browser_manager)
        self.scraped_ids = set()  # Track duplicates
    
    async def scrape(
        self,
        limit: int = 100,
        cursor: Optional[str] = None
    ) -> BookmarksResult:
        """
        Scrape bookmarked tweets.
        
        Args:
            limit: Maximum number of bookmarks to scrape
            cursor: Pagination cursor for resuming
            
        Returns:
            BookmarksResult with scraped bookmarks
        """
        result = BookmarksResult()
        
        try:
            # Navigate to bookmarks page
            self.page = await self.browser.get_page()
            await self.page.goto(self.BOOKMARKS_URL, wait_until="networkidle")
            
            # Wait for content to load
            await self.page.wait_for_selector('[data-testid="tweet"]', timeout=10000)
            
            while result.total_scraped < limit:
                # Extract visible tweets
                tweets = await self.page.query_selector_all('[data-testid="tweet"]')
                
                for tweet_element in tweets:
                    if result.total_scraped >= limit:
                        break
                    
                    try:
                        bookmark = await self._extract_data(tweet_element)
                        
                        # Skip duplicates
                        if bookmark.tweet_id in self.scraped_ids:
                            continue
                        
                        self.scraped_ids.add(bookmark.tweet_id)
                        result.items.append(bookmark)
                        result.total_scraped += 1
                        
                    except Exception as e:
                        self.logger.warning(f"Failed to extract tweet: {e}")
                        continue
                
                # Check if we should continue paginating
                if result.total_scraped >= limit:
                    break
                
                # Handle pagination
                has_more = await self._handle_pagination()
                if not has_more:
                    break
                
                # Small delay to avoid rate limits
                await asyncio.sleep(1)
            
            result.has_more = await self._check_has_more()
            return result
            
        except Exception as e:
            raise ScraperError(f"Bookmarks scraping failed: {e}")
    
    async def _extract_data(self, element) -> Bookmark:
        """Extract bookmark data from a tweet element."""
        
        # Get tweet ID from the link
        link = await element.query_selector('a[href*="/status/"]')
        href = await link.get_attribute("href")
        tweet_id = href.split("/status/")[1].split("/")[0].split("?")[0]
        
        # Get author info
        author_link = await element.query_selector('[data-testid="User-Name"] a')
        author_username = (await author_link.get_attribute("href")).strip("/")
        author_name_el = await element.query_selector('[data-testid="User-Name"] span')
        author_name = await author_name_el.inner_text()
        
        # Get tweet text
        text_el = await element.query_selector('[data-testid="tweetText"]')
        text = await text_el.inner_text() if text_el else ""
        
        # Get engagement metrics
        likes = await self._get_metric(element, "like")
        retweets = await self._get_metric(element, "retweet")
        replies = await self._get_metric(element, "reply")
        
        # Get media URLs
        media_urls = await self._extract_media(element)
        
        return Bookmark(
            tweet_id=tweet_id,
            author_username=author_username,
            author_name=author_name,
            text=text,
            likes=likes,
            retweets=retweets,
            replies=replies,
            media_urls=media_urls
        )
    
    async def _get_metric(self, element, metric_type: str) -> int:
        """Extract engagement metric from tweet."""
        try:
            selector = f'[data-testid="{metric_type}"] span'
            metric_el = await element.query_selector(selector)
            if metric_el:
                text = await metric_el.inner_text()
                return self._parse_count(text)
        except:
            pass
        return 0
    
    def _parse_count(self, text: str) -> int:
        """Parse count strings like '1.2K' or '5M'."""
        text = text.strip().upper()
        if not text:
            return 0
        
        multipliers = {"K": 1000, "M": 1000000, "B": 1000000000}
        for suffix, multiplier in multipliers.items():
            if text.endswith(suffix):
                return int(float(text[:-1]) * multiplier)
        
        return int(text.replace(",", ""))
    
    async def _extract_media(self, element) -> List[str]:
        """Extract media URLs from tweet."""
        urls = []
        media_elements = await element.query_selector_all('img[src*="media"], video source')
        
        for media in media_elements:
            src = await media.get_attribute("src")
            if src and "media" in src:
                urls.append(src)
        
        return urls
    
    async def _handle_pagination(self) -> bool:
        """Scroll to load more content."""
        # Get current scroll position
        prev_height = await self.page.evaluate("document.body.scrollHeight")
        
        # Scroll to bottom
        await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        
        # Wait for new content
        await asyncio.sleep(2)
        
        # Check if new content loaded
        new_height = await self.page.evaluate("document.body.scrollHeight")
        
        return new_height > prev_height
    
    async def _check_has_more(self) -> bool:
        """Check if more content is available."""
        end_message = await self.page.query_selector('[data-testid="emptyState"]')
        return end_message is None
```

## Error Handling Patterns

Implement robust error handling in your scraper:

```python
from xtools.core.exceptions import (
    ScraperError,
    RateLimitError,
    AuthenticationError,
    NetworkError
)
import asyncio
from functools import wraps

def with_retry(max_retries: int = 3, delay: float = 1.0):
    """Decorator for retry logic with exponential backoff."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except RateLimitError as e:
                    wait_time = e.retry_after or (delay * (2 ** attempt))
                    await asyncio.sleep(wait_time)
                    last_error = e
                except NetworkError as e:
                    await asyncio.sleep(delay * (2 ** attempt))
                    last_error = e
                except AuthenticationError:
                    raise  # Don't retry auth errors
            raise last_error
        return wrapper
    return decorator

class RobustBookmarksScraper(BookmarksScraper):
    """Bookmarks scraper with enhanced error handling."""
    
    @with_retry(max_retries=3)
    async def scrape(self, limit: int = 100, **kwargs) -> BookmarksResult:
        return await super().scrape(limit=limit, **kwargs)
    
    async def _extract_data(self, element) -> Bookmark:
        """Extract with fallbacks for missing data."""
        try:
            return await super()._extract_data(element)
        except Exception as e:
            self.logger.warning(f"Partial extraction: {e}")
            # Return partial data rather than failing
            return Bookmark(
                tweet_id="unknown",
                author_username="unknown",
                author_name="Unknown",
                text=""
            )
```

## Registering Custom Scrapers

Register your scraper with XTools for easy access:

```python
from xtools import XTools

# Method 1: Direct registration
async with XTools() as x:
    # Register the scraper
    x.register_scraper("bookmarks", BookmarksScraper)
    
    # Use it like built-in scrapers
    bookmarks = await x.scrape.bookmarks(limit=50)

# Method 2: Plugin-based registration
from xtools.core.plugins import Plugin

class BookmarksPlugin(Plugin):
    """Plugin that adds bookmarks scraping capability."""
    
    name = "bookmarks"
    version = "1.0.0"
    
    def on_init(self, xtools):
        xtools.register_scraper("bookmarks", BookmarksScraper)

# Register plugin
XTools.use(BookmarksPlugin())
```

## Complete Example: Bookmarks Scraper

Here's the full implementation you can use as a template:

```python
"""
Custom Bookmarks Scraper for XTools
Save as: my_scrapers/bookmarks.py
"""

from xtools.scrapers.base import BaseScraper
from xtools.core.exceptions import ScraperError
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import asyncio
import logging

logger = logging.getLogger(__name__)


class Bookmark(BaseModel):
    tweet_id: str
    author_username: str
    author_name: str
    text: str
    likes: int = 0
    retweets: int = 0
    replies: int = 0
    media_urls: List[str] = Field(default_factory=list)
    scraped_at: datetime = Field(default_factory=datetime.utcnow)


class BookmarksResult(BaseModel):
    items: List[Bookmark] = Field(default_factory=list)
    total_scraped: int = 0
    has_more: bool = False


class BookmarksScraper(BaseScraper):
    """Scrape your bookmarked tweets."""
    
    async def scrape(self, limit: int = 100) -> BookmarksResult:
        result = BookmarksResult()
        seen_ids = set()
        
        page = await self.browser.get_page()
        await page.goto("https://x.com/i/bookmarks")
        await page.wait_for_selector('[data-testid="tweet"]', timeout=15000)
        
        while result.total_scraped < limit:
            tweets = await page.query_selector_all('[data-testid="tweet"]')
            
            for tweet in tweets:
                if result.total_scraped >= limit:
                    break
                    
                bookmark = await self._extract_data(tweet)
                if bookmark.tweet_id not in seen_ids:
                    seen_ids.add(bookmark.tweet_id)
                    result.items.append(bookmark)
                    result.total_scraped += 1
            
            if not await self._handle_pagination(page):
                break
        
        result.has_more = result.total_scraped == limit
        return result
    
    async def _extract_data(self, element) -> Bookmark:
        # Implementation as shown above
        ...
    
    async def _handle_pagination(self, page) -> bool:
        prev_height = await page.evaluate("document.body.scrollHeight")
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)
        new_height = await page.evaluate("document.body.scrollHeight")
        return new_height > prev_height


# Usage
async def main():
    from xtools import XTools
    
    async with XTools() as x:
        x.register_scraper("bookmarks", BookmarksScraper)
        
        bookmarks = await x.scrape.bookmarks(limit=50)
        
        for b in bookmarks.items:
            print(f"@{b.author_username}: {b.text[:50]}...")
        
        # Export to CSV
        x.export.to_csv(bookmarks.items, "my_bookmarks.csv")


if __name__ == "__main__":
    asyncio.run(main())
```

## Best Practices

!!! tip "Scraper Development Tips"
    1. **Always use data models** - Pydantic models ensure data consistency
    2. **Handle missing data gracefully** - Not all tweets have all fields
    3. **Implement pagination properly** - Check for end-of-content indicators
    4. **Add delays between requests** - Respect rate limits
    5. **Log extensively** - Debugging scrapers is easier with good logs
    6. **Test with small limits first** - Verify extraction before large runs

!!! warning "Rate Limiting"
    Always include delays between pagination requests. XTools' built-in rate limiter helps, but your scraper should also be respectful of the platform.

## Next Steps

- [Plugins](plugins.md) - Extend XTools with plugins
- [Error Handling](errors.md) - Comprehensive error handling guide
- [Testing](testing.md) - Test your custom scrapers
