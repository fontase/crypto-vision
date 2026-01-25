"""
XTools Authentication Manager

Handles X/Twitter authentication via browser automation.
"""

import asyncio
from pathlib import Path
from typing import Optional

from loguru import logger

from xtools.core.browser import BrowserManager
from xtools.core.exceptions import AuthenticationError


class AuthManager:
    """
    Manages authentication for X/Twitter.
    
    Supports login, session persistence, and session validation.
    """
    
    X_LOGIN_URL = "https://x.com/i/flow/login"
    X_HOME_URL = "https://x.com/home"
    
    # Selectors for login flow
    SELECTORS = {
        "username_input": 'input[autocomplete="username"]',
        "password_input": 'input[autocomplete="current-password"]',
        "next_button": 'button:has-text("Next")',
        "login_button": 'button[data-testid="LoginForm_Login_Button"]',
        "home_timeline": '[data-testid="primaryColumn"]',
        "error_message": '[data-testid="toast"]',
    }
    
    def __init__(self, browser: BrowserManager):
        self.browser = browser
        self._is_authenticated = False
    
    async def login(
        self,
        username: str,
        password: str,
        session_file: Optional[str | Path] = None,
    ) -> bool:
        """
        Login to X/Twitter.
        
        Args:
            username: X/Twitter username or email
            password: Account password
            session_file: Path to save session for reuse
            
        Returns:
            True if login successful
            
        Raises:
            AuthenticationError: If login fails
        """
        logger.info(f"Attempting login for user: {username}")
        
        # Try to load existing session first
        if session_file and Path(session_file).exists():
            if await self._try_session(session_file):
                logger.info("Logged in using saved session")
                return True
        
        # Perform fresh login
        page = await self.browser.new_page()
        
        try:
            await page.goto(self.X_LOGIN_URL, wait_until="networkidle")
            await asyncio.sleep(2)  # Wait for page to stabilize
            
            # Enter username
            await page.wait_for_selector(self.SELECTORS["username_input"], timeout=10000)
            await page.fill(self.SELECTORS["username_input"], username)
            await page.click(self.SELECTORS["next_button"])
            await asyncio.sleep(1)
            
            # Enter password
            await page.wait_for_selector(self.SELECTORS["password_input"], timeout=10000)
            await page.fill(self.SELECTORS["password_input"], password)
            await page.click(self.SELECTORS["login_button"])
            
            # Wait for home page
            try:
                await page.wait_for_selector(
                    self.SELECTORS["home_timeline"],
                    timeout=15000,
                )
                self._is_authenticated = True
                logger.info("Login successful")
                
                # Save session
                if session_file:
                    await self.browser.save_session(session_file)
                
                return True
                
            except Exception:
                # Check for error message
                error = await page.query_selector(self.SELECTORS["error_message"])
                error_text = await error.text_content() if error else "Unknown error"
                raise AuthenticationError(f"Login failed: {error_text}")
                
        except AuthenticationError:
            raise
        except Exception as e:
            logger.error(f"Login error: {e}")
            raise AuthenticationError(f"Login failed: {e}")
    
    async def _try_session(self, session_file: str | Path) -> bool:
        """Try to authenticate using saved session."""
        try:
            await self.browser.new_context(storage_state=session_file)
            page = await self.browser.new_page()
            await page.goto(self.X_HOME_URL, wait_until="networkidle")
            
            # Check if we're on the home page
            home = await page.query_selector(self.SELECTORS["home_timeline"])
            if home:
                self._is_authenticated = True
                return True
            
            return False
            
        except Exception as e:
            logger.warning(f"Session restore failed: {e}")
            return False
    
    async def is_logged_in(self) -> bool:
        """Check if currently logged in."""
        if not self._is_authenticated:
            return False
        
        if self.browser.page is None:
            return False
        
        try:
            await self.browser.page.goto(self.X_HOME_URL, wait_until="domcontentloaded")
            home = await self.browser.page.query_selector(self.SELECTORS["home_timeline"])
            return home is not None
        except Exception:
            return False
    
    async def logout(self) -> None:
        """Logout from X/Twitter."""
        if self.browser.page:
            await self.browser.page.goto("https://x.com/logout", wait_until="networkidle")
        self._is_authenticated = False
        logger.info("Logged out")
    
    @property
    def is_authenticated(self) -> bool:
        """Check authentication status."""
        return self._is_authenticated
