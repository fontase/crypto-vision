# Testing XTools Automation

Learn how to write reliable tests for your XTools automation scripts using pytest-asyncio, mocking, and best practices.

!!! note "Educational Purpose"
    This documentation is for educational purposes only. Always respect platform terms of service.

## Setup

### Install Testing Dependencies

```bash
pip install pytest pytest-asyncio pytest-cov pytest-mock aioresponses
```

### pytest Configuration

Create `pytest.ini` or add to `pyproject.toml`:

=== "pytest.ini"
    ```ini
    [pytest]
    asyncio_mode = auto
    testpaths = tests
    addopts = -v --cov=src --cov-report=html
    filterwarnings = ignore::DeprecationWarning
    ```

=== "pyproject.toml"
    ```toml
    [tool.pytest.ini_options]
    asyncio_mode = "auto"
    testpaths = ["tests"]
    addopts = "-v --cov=src --cov-report=html"
    ```

### Project Structure

```
my_xtools_project/
├── src/
│   └── my_automation/
│       ├── __init__.py
│       └── scripts.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_scraping.py
│   ├── test_actions.py
│   └── fixtures/
│       ├── tweets.json
│       └── users.json
└── pyproject.toml
```

## Writing Async Tests

### Basic Test Structure

```python
# tests/test_scraping.py
import pytest
from my_automation.scripts import get_user_tweets

@pytest.mark.asyncio
async def test_get_user_tweets():
    """Test basic tweet scraping."""
    result = await get_user_tweets("test_user", limit=10)
    
    assert result is not None
    assert len(result.items) <= 10
    assert all(hasattr(t, 'tweet_id') for t in result.items)
```

### Using Fixtures

```python
# tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from xtools import XTools

@pytest.fixture
def mock_browser():
    """Mock browser manager."""
    browser = MagicMock()
    browser.get_page = AsyncMock()
    return browser

@pytest.fixture
def mock_xtools(mock_browser):
    """Mock XTools instance."""
    xtools = MagicMock(spec=XTools)
    xtools.browser = mock_browser
    xtools.scrape = MagicMock()
    xtools.engage = MagicMock()
    return xtools

@pytest.fixture
def sample_tweets():
    """Sample tweet data for testing."""
    return [
        {
            "tweet_id": "123456",
            "author_username": "testuser",
            "text": "Hello world!",
            "likes": 10,
            "retweets": 5
        },
        {
            "tweet_id": "123457",
            "author_username": "testuser",
            "text": "Second tweet",
            "likes": 20,
            "retweets": 8
        }
    ]

@pytest.fixture
def sample_user():
    """Sample user data."""
    return {
        "user_id": "999",
        "username": "testuser",
        "name": "Test User",
        "followers_count": 1000,
        "following_count": 500,
        "is_verified": False
    }
```

## Mocking XTools

### Mock Scraper Responses

```python
# tests/test_scraping.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from xtools.models.tweet import Tweet
from xtools.scrapers.replies import RepliesResult

@pytest.fixture
def mock_replies_result(sample_tweets):
    """Create mock replies result."""
    result = RepliesResult(
        items=[Tweet(**t) for t in sample_tweets],
        total_scraped=len(sample_tweets),
        has_more=False
    )
    return result

@pytest.mark.asyncio
async def test_scrape_replies_returns_tweets(mock_replies_result):
    """Test that scraping replies returns expected data."""
    
    with patch('xtools.XTools') as MockXTools:
        # Setup mock
        mock_instance = AsyncMock()
        mock_instance.scrape.replies = AsyncMock(return_value=mock_replies_result)
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        # Run test
        from xtools import XTools
        async with XTools() as x:
            result = await x.scrape.replies("https://x.com/user/status/123")
        
        # Assertions
        assert len(result.items) == 2
        assert result.items[0].tweet_id == "123456"
        mock_instance.scrape.replies.assert_called_once()

@pytest.mark.asyncio
async def test_scrape_with_limit():
    """Test scraping respects limit parameter."""
    
    mock_result = MagicMock()
    mock_result.items = [MagicMock() for _ in range(50)]
    mock_result.total_scraped = 50
    
    with patch('xtools.XTools') as MockXTools:
        mock_instance = AsyncMock()
        mock_instance.scrape.followers = AsyncMock(return_value=mock_result)
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        from xtools import XTools
        async with XTools() as x:
            result = await x.scrape.followers("testuser", limit=50)
        
        mock_instance.scrape.followers.assert_called_with("testuser", limit=50)
```

### Mock Actions

```python
# tests/test_actions.py
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_follow_user():
    """Test following a user."""
    
    with patch('xtools.XTools') as MockXTools:
        mock_instance = AsyncMock()
        mock_instance.follow.user = AsyncMock(return_value=True)
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        from xtools import XTools
        async with XTools() as x:
            result = await x.follow.user("targetuser")
        
        assert result is True
        mock_instance.follow.user.assert_called_once_with("targetuser")

@pytest.mark.asyncio
async def test_unfollow_non_followers():
    """Test unfollowing non-followers."""
    
    mock_result = MagicMock()
    mock_result.unfollowed_users = ["user1", "user2", "user3"]
    mock_result.skipped_users = []
    
    with patch('xtools.XTools') as MockXTools:
        mock_instance = AsyncMock()
        mock_instance.unfollow.non_followers = AsyncMock(return_value=mock_result)
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        from xtools import XTools
        async with XTools() as x:
            result = await x.unfollow.non_followers(
                max_unfollows=10,
                whitelist=["friend1"]
            )
        
        assert len(result.unfollowed_users) == 3
```

## Integration Testing

### Test Against Real Browser (Careful!)

```python
# tests/integration/test_real_scraping.py
import pytest
import os

# Skip in CI
pytestmark = pytest.mark.skipif(
    os.getenv("CI") == "true",
    reason="Integration tests skipped in CI"
)

@pytest.fixture
async def real_xtools():
    """Create real XTools instance with test account."""
    from xtools import XTools
    
    async with XTools(headless=True) as x:
        # Load test session
        await x.auth.load_session("test_session.json")
        yield x

@pytest.mark.integration
@pytest.mark.asyncio
async def test_real_profile_scrape(real_xtools):
    """Integration test: scrape a real public profile."""
    
    result = await real_xtools.scrape.profile("twitter")
    
    assert result is not None
    assert result.username == "twitter"
    assert result.followers_count > 0
```

### Recording and Replaying Responses

Use `vcrpy` or custom solution:

```python
# tests/conftest.py
import json
from pathlib import Path
from unittest.mock import AsyncMock

FIXTURES_DIR = Path(__file__).parent / "fixtures"

class ResponseRecorder:
    """Record and replay HTTP responses."""
    
    def __init__(self, cassette_path: Path):
        self.cassette_path = cassette_path
        self.responses = []
    
    def load(self):
        if self.cassette_path.exists():
            with open(self.cassette_path) as f:
                self.responses = json.load(f)
    
    def save(self):
        with open(self.cassette_path, "w") as f:
            json.dump(self.responses, f, indent=2)
    
    def get_mock_response(self, index: int):
        if index < len(self.responses):
            return self.responses[index]
        return None

@pytest.fixture
def recorded_responses():
    """Load recorded API responses."""
    recorder = ResponseRecorder(FIXTURES_DIR / "api_responses.json")
    recorder.load()
    return recorder
```

## Testing Custom Scrapers

```python
# tests/test_custom_scraper.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from my_scrapers.bookmarks import BookmarksScraper, Bookmark, BookmarksResult

@pytest.fixture
def mock_page():
    """Create mock Playwright page."""
    page = AsyncMock()
    
    # Mock query selectors
    tweet_element = AsyncMock()
    tweet_element.query_selector = AsyncMock(return_value=AsyncMock(
        get_attribute=AsyncMock(return_value="/user/status/123456"),
        inner_text=AsyncMock(return_value="Test tweet content")
    ))
    tweet_element.query_selector_all = AsyncMock(return_value=[])
    
    page.query_selector_all = AsyncMock(return_value=[tweet_element])
    page.goto = AsyncMock()
    page.wait_for_selector = AsyncMock()
    page.evaluate = AsyncMock(side_effect=[1000, 1000])  # No scroll change
    
    return page

@pytest.fixture
def mock_browser(mock_page):
    """Create mock browser manager."""
    browser = MagicMock()
    browser.get_page = AsyncMock(return_value=mock_page)
    return browser

@pytest.mark.asyncio
async def test_bookmarks_scraper_basic(mock_browser):
    """Test basic bookmarks scraping."""
    scraper = BookmarksScraper(mock_browser)
    
    result = await scraper.scrape(limit=10)
    
    assert isinstance(result, BookmarksResult)
    assert result.total_scraped >= 0

@pytest.mark.asyncio
async def test_bookmarks_scraper_pagination(mock_browser, mock_page):
    """Test pagination stops when no new content."""
    # Simulate no scroll change (end of content)
    mock_page.evaluate = AsyncMock(side_effect=[1000, 1000])
    
    scraper = BookmarksScraper(mock_browser)
    result = await scraper.scrape(limit=100)
    
    assert result.has_more is False

@pytest.mark.asyncio
async def test_bookmarks_extracts_tweet_id(mock_browser, mock_page):
    """Test tweet ID extraction."""
    link_mock = AsyncMock()
    link_mock.get_attribute = AsyncMock(return_value="/someuser/status/123456789")
    
    tweet_el = AsyncMock()
    tweet_el.query_selector = AsyncMock(return_value=link_mock)
    
    scraper = BookmarksScraper(mock_browser)
    scraper.page = mock_page
    
    # This would test the internal _extract_data method
    # bookmark = await scraper._extract_data(tweet_el)
    # assert bookmark.tweet_id == "123456789"
```

## Testing Error Handling

```python
# tests/test_errors.py
import pytest
from xtools.core.exceptions import (
    RateLimitError,
    AuthenticationError,
    ScraperError
)

@pytest.mark.asyncio
async def test_handles_rate_limit():
    """Test rate limit error is handled properly."""
    from unittest.mock import AsyncMock, patch
    
    with patch('xtools.XTools') as MockXTools:
        mock_instance = AsyncMock()
        mock_instance.scrape.followers = AsyncMock(
            side_effect=RateLimitError("Rate limited", retry_after=60)
        )
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        from xtools import XTools
        async with XTools() as x:
            with pytest.raises(RateLimitError) as exc_info:
                await x.scrape.followers("user")
            
            assert exc_info.value.retry_after == 60

@pytest.mark.asyncio
async def test_authentication_error():
    """Test authentication errors are raised."""
    from unittest.mock import AsyncMock, patch
    
    with patch('xtools.XTools') as MockXTools:
        mock_instance = AsyncMock()
        mock_instance.auth.load_session = AsyncMock(
            side_effect=AuthenticationError("Session expired")
        )
        MockXTools.return_value.__aenter__.return_value = mock_instance
        
        from xtools import XTools
        async with XTools() as x:
            with pytest.raises(AuthenticationError):
                await x.auth.load_session("invalid.json")
```

## CI/CD with GitHub Actions

```yaml
# .github/workflows/tests.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.10', '3.11', '3.12']
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"
          playwright install chromium
      
      - name: Run tests
        run: pytest --cov=src --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: coverage.xml
          fail_ci_if_error: true

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Install linters
        run: pip install ruff mypy
      
      - name: Run ruff
        run: ruff check src tests
      
      - name: Run mypy
        run: mypy src
```

## Coverage Reporting

### Configure Coverage

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
branch = true
omit = ["tests/*", "*/__init__.py"]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise NotImplementedError",
    "if TYPE_CHECKING:",
]
fail_under = 80
```

### Generate Reports

```bash
# Run with coverage
pytest --cov=src --cov-report=html --cov-report=term

# Open HTML report
open htmlcov/index.html
```

## Best Practices

!!! tip "Testing Tips"
    1. **Mock external dependencies** - Never hit real APIs in unit tests
    2. **Use fixtures** - Keep test data consistent and reusable
    3. **Test edge cases** - Empty responses, errors, rate limits
    4. **Keep tests fast** - Mock async operations
    5. **Use markers** - Separate unit from integration tests

!!! warning "Integration Tests"
    Only run integration tests against test accounts, never production. Use environment variables to control test behavior.

```python
# conftest.py
import pytest

def pytest_configure(config):
    config.addinivalue_line(
        "markers", "integration: mark test as integration test"
    )

def pytest_collection_modifyitems(config, items):
    if not config.getoption("--run-integration"):
        skip_integration = pytest.mark.skip(reason="need --run-integration")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)
```

## Next Steps

- [Error Handling](errors.md) - Handle errors properly
- [Custom Scrapers](custom-scrapers.md) - Build testable scrapers
- [Plugins](plugins.md) - Test plugin implementations
