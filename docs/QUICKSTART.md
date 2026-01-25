# ⚡ Quick Start Guide

Get up and running with XTools in under 5 minutes.

---

## 📦 Installation

### Option 1: pip (Recommended)

```bash
pip install xtools
```

### Option 2: From Source

```bash
git clone https://github.com/nirholas/Get-Tweet-Replies-With-Python-Tweepy.git
cd Get-Tweet-Replies-With-Python-Tweepy
pip install -e .
```

### Option 3: With AI Features

```bash
pip install xtools[ai]  # Includes OpenAI, Anthropic clients
```

---

## 🔐 Authentication

XTools uses cookie-based authentication (no API keys needed!).

### Step 1: Get Your Session Cookie

1. Open [x.com](https://x.com) in your browser
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to **Application** → **Cookies** → **x.com**
4. Find the `auth_token` cookie and copy its value

### Step 2: Configure XTools

```python
from xtools import XTools

# Option A: Pass directly
async with XTools(auth_token="your_auth_token_here") as x:
    ...

# Option B: Environment variable (recommended)
# export XTOOLS_AUTH_TOKEN=your_auth_token_here
async with XTools() as x:
    ...

# Option C: Config file
# Create ~/.xtools/config.yaml
```

**~/.xtools/config.yaml:**
```yaml
auth:
  auth_token: "your_auth_token_here"
  
settings:
  headless: true
  rate_limit: true
```

---

## 🎯 5-Minute Examples

### Example 1: Get Tweet Replies

The original purpose of this repo - finally working!

```python
import asyncio
from xtools import XTools

async def main():
    async with XTools() as x:
        # Get replies to any tweet
        replies = await x.scrape.replies(
            "https://x.com/elonmusk/status/1234567890",
            limit=50
        )
        
        print(f"Found {len(replies)} replies!")
        
        for reply in replies[:5]:
            print(f"@{reply.username}: {reply.text[:100]}...")
        
        # Export to CSV
        x.export.to_csv(replies, "replies.csv")

asyncio.run(main())
```

### Example 2: Unfollow Non-Followers

The most requested feature!

```python
import asyncio
from xtools import XTools

async def main():
    async with XTools() as x:
        # First, do a dry run to see who would be unfollowed
        preview = await x.unfollow.non_followers(
            max_unfollows=50,
            whitelist=["friend1", "important_account"],
            dry_run=True
        )
        
        print(f"Would unfollow {len(preview.unfollowed_users)} users:")
        for user in preview.unfollowed_users[:10]:
            print(f"  - @{user}")
        
        # If you're sure, run for real
        # result = await x.unfollow.non_followers(dry_run=False)

asyncio.run(main())
```

### Example 3: Auto-Like by Keywords

```python
import asyncio
from xtools import XTools

async def main():
    async with XTools() as x:
        # Auto-like tweets containing keywords
        result = await x.engage.auto_like(
            keywords=["python", "machinelearning", "AI"],
            max_likes=25,
            duration_minutes=15
        )
        
        print(f"Liked {result.success_count} tweets!")

asyncio.run(main())
```

### Example 4: Detect Unfollowers

```python
import asyncio
from xtools import XTools

async def main():
    async with XTools() as x:
        # Check who unfollowed you
        report = await x.monitor.unfollowers()
        
        if report.unfollowers:
            print(f"😢 {len(report.unfollowers)} people unfollowed you:")
            for user in report.unfollowers:
                print(f"  - @{user}")
        else:
            print("✅ No one unfollowed you!")
        
        if report.new_followers:
            print(f"🎉 {len(report.new_followers)} new followers!")

asyncio.run(main())
```

### Example 5: AI-Powered Reply Generation

```python
import asyncio
from xtools import XTools
from xtools.ai import ContentGenerator

async def main():
    async with XTools() as x:
        # Initialize AI (requires API key)
        ai = ContentGenerator(
            provider="openai",
            api_key="sk-..."
        )
        
        # Generate reply for a tweet
        tweet = "Just shipped my first Python package! 🐍"
        
        reply = await ai.generate_reply(
            tweet_text=tweet,
            style="supportive"
        )
        
        print(f"Suggested reply: {reply}")
        # Output: "Congrats! 🎉 What does it do? Would love to check it out!"

asyncio.run(main())
```

---

## 🖥️ CLI Quick Start

```bash
# Setup authentication
xtools auth login

# Get tweet replies
xtools scrape replies https://x.com/user/status/123 -o replies.csv

# Unfollow non-followers (dry run)
xtools unfollow non-followers --dry-run

# Auto-like by keyword
xtools engage auto-like "python" --max 25

# Check unfollowers
xtools monitor unfollowers
```

---

## 📁 Project Structure

After installation, here's how to organize your project:

```
my_twitter_project/
├── main.py              # Your main script
├── config.yaml          # Configuration (optional)
├── .env                 # Environment variables
└── output/              # Exported data
    ├── replies.csv
    ├── followers.json
    └── unfollowers.json
```

**main.py:**
```python
import asyncio
from xtools import XTools

async def main():
    async with XTools() as x:
        # Your automation code here
        pass

if __name__ == "__main__":
    asyncio.run(main())
```

**.env:**
```
XTOOLS_AUTH_TOKEN=your_auth_token
OPENAI_API_KEY=sk-...  # Optional, for AI features
```

---

## ⚠️ Important Notes

### Rate Limits
XTools automatically handles rate limiting, but be aware:
- Don't run multiple instances simultaneously
- Start with small numbers (10-25 actions)
- Wait between sessions (15-30 minutes)

### Session Expiry
Your auth_token may expire. If you get authentication errors:
1. Re-fetch your auth_token from the browser
2. Update your configuration

### Headless Mode
By default, XTools runs headless (no visible browser). To see what's happening:

```python
async with XTools(headless=False) as x:
    # Browser window will be visible
    pass
```

---

## 🚀 Next Steps

1. **[Full API Reference](API_REFERENCE.md)** - All available methods
2. **[Examples](EXAMPLES.md)** - More code examples
3. **[AI Features](AI_FEATURES.md)** - AI integration guide
4. **[CLI Reference](CLI_REFERENCE.md)** - All CLI commands

---

## 🆘 Troubleshooting

### "Authentication failed"
- Re-fetch your auth_token from the browser
- Make sure you're logged into X/Twitter

### "Element not found"
- X/Twitter may have updated their UI
- Check for XTools updates: `pip install --upgrade xtools`

### "Rate limited"
- You're making too many requests
- Wait 15-30 minutes before continuing
- Reduce your action limits

### Need help?
- [Open an issue](https://github.com/nirholas/Get-Tweet-Replies-With-Python-Tweepy/issues)
- [Check FAQ](FAQ.md)

---

<p align="center">
  <strong>Ready to automate? Let's go! 🚀</strong>
</p>
