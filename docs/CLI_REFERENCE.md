# 🖥️ CLI Reference

Complete command-line interface documentation for XTools.

---

## Installation

```bash
pip install xtools
```

After installation, the `xtools` command is available globally.

---

## Global Options

```bash
xtools [OPTIONS] COMMAND [ARGS]

Options:
  -c, --config PATH    Config file path (default: ~/.xtools/config.yaml)
  -v, --verbose        Enable verbose output
  --headless/--no-headless  Run browser headless (default: headless)
  --version            Show version
  --help               Show help
```

---

## Authentication Commands

### `xtools auth login`

Setup authentication with your X/Twitter session.

```bash
xtools auth login [OPTIONS]

Options:
  --token TEXT    Your auth_token cookie value
  --interactive   Interactive setup wizard
```

**Examples:**

```bash
# Interactive login
xtools auth login --interactive

# Direct token
xtools auth login --token "your_auth_token_here"
```

### `xtools auth logout`

Remove saved authentication.

```bash
xtools auth logout
```

### `xtools auth status`

Check authentication status.

```bash
xtools auth status

# Output:
# ✅ Authenticated as @your_username
# Session expires: 2026-03-15
```

---

## Scraping Commands

### `xtools scrape replies`

Scrape replies to a tweet.

```bash
xtools scrape replies URL [OPTIONS]

Arguments:
  URL    Tweet URL

Options:
  -l, --limit INT      Max replies (default: 100)
  -o, --output PATH    Output file (.json or .csv)
  --format TEXT        Output format: json, csv (default: json)
```

**Examples:**

```bash
# Basic
xtools scrape replies https://x.com/user/status/123

# With options
xtools scrape replies https://x.com/user/status/123 -l 200 -o replies.csv

# JSON output
xtools scrape replies https://x.com/user/status/123 --format json -o replies.json
```

### `xtools scrape profile`

Scrape user profile information.

```bash
xtools scrape profile USERNAME [OPTIONS]

Arguments:
  USERNAME    X/Twitter username (without @)

Options:
  -o, --output PATH    Output file
```

**Examples:**

```bash
xtools scrape profile elonmusk
xtools scrape profile python -o python_profile.json
```

### `xtools scrape followers`

Scrape a user's followers.

```bash
xtools scrape followers USERNAME [OPTIONS]

Arguments:
  USERNAME    X/Twitter username

Options:
  -l, --limit INT      Max followers (default: 100)
  -o, --output PATH    Output file
  --format TEXT        json or csv
```

**Examples:**

```bash
xtools scrape followers python -l 500 -o followers.csv
```

### `xtools scrape following`

Scrape who a user follows.

```bash
xtools scrape following USERNAME [OPTIONS]

Arguments:
  USERNAME    X/Twitter username

Options:
  -l, --limit INT      Max accounts (default: 100)
  -o, --output PATH    Output file
```

### `xtools scrape tweets`

Scrape a user's tweets.

```bash
xtools scrape tweets USERNAME [OPTIONS]

Arguments:
  USERNAME    X/Twitter username

Options:
  -l, --limit INT          Max tweets (default: 100)
  -o, --output PATH        Output file
  --include-replies        Include replies
  --include-retweets       Include retweets
```

**Examples:**

```bash
xtools scrape tweets python -l 200 -o tweets.json
xtools scrape tweets python --include-replies
```

### `xtools scrape search`

Search for tweets.

```bash
xtools scrape search QUERY [OPTIONS]

Arguments:
  QUERY    Search query

Options:
  -l, --limit INT      Max results (default: 50)
  -o, --output PATH    Output file
  --filter TEXT        top, latest, people, media (default: latest)
```

**Examples:**

```bash
xtools scrape search "Python tutorial" -l 100 --filter latest
xtools scrape search "from:python min_faves:100" -o popular.json
```

### `xtools scrape hashtag`

Scrape tweets with a hashtag.

```bash
xtools scrape hashtag TAG [OPTIONS]

Arguments:
  TAG    Hashtag (without #)

Options:
  -l, --limit INT      Max tweets (default: 100)
  -o, --output PATH    Output file
  --filter TEXT        top or latest
```

**Examples:**

```bash
xtools scrape hashtag Python -l 200 -o python_hashtag.csv
```

### `xtools scrape thread`

Unroll and scrape a thread.

```bash
xtools scrape thread URL [OPTIONS]

Arguments:
  URL    Thread URL (first tweet)

Options:
  -o, --output PATH    Output file
```

### `xtools scrape media`

Scrape a user's media posts.

```bash
xtools scrape media USERNAME [OPTIONS]

Arguments:
  USERNAME    X/Twitter username

Options:
  -l, --limit INT      Max media (default: 50)
  -o, --output PATH    Output file
  --download           Download media files
```

### `xtools scrape likes`

Scrape who liked a tweet.

```bash
xtools scrape likes URL [OPTIONS]

Arguments:
  URL    Tweet URL

Options:
  -l, --limit INT      Max likers (default: 100)
  -o, --output PATH    Output file
```

---

## Unfollow Commands

### `xtools unfollow non-followers`

Unfollow users who don't follow you back.

```bash
xtools unfollow non-followers [OPTIONS]

Options:
  -m, --max INT            Max unfollows (default: 100)
  -w, --whitelist TEXT     Users to never unfollow (can repeat)
  --min-followers INT      Keep if they have >= this many followers
  --dry-run                Preview without unfollowing
  -o, --output PATH        Export unfollowed list
```

**Examples:**

```bash
# Dry run first!
xtools unfollow non-followers --dry-run

# With whitelist
xtools unfollow non-followers --max 50 -w friend1 -w friend2

# Keep accounts with 10k+ followers
xtools unfollow non-followers --min-followers 10000

# Export list
xtools unfollow non-followers -o unfollowed.txt
```

### `xtools unfollow everyone`

⚠️ Unfollow ALL accounts.

```bash
xtools unfollow everyone [OPTIONS]

Options:
  -m, --max INT        Max unfollows (default: 500)
  --dry-run            Preview without unfollowing
  --export-first       Export following list before (recommended!)
  --confirm            Skip confirmation prompt
```

**Examples:**

```bash
# Always dry run first!
xtools unfollow everyone --dry-run

# With backup
xtools unfollow everyone --export-first -o following_backup.json
```

### `xtools unfollow smart`

Smart time-based unfollow.

```bash
xtools unfollow smart [OPTIONS]

Options:
  --days INT           Days to wait for follow-back (default: 3)
  -m, --max INT        Max unfollows (default: 50)
  --dry-run            Preview only
```

**Examples:**

```bash
xtools unfollow smart --days 5 --max 25
```

---

## Follow Commands

### `xtools follow user`

Follow a specific user.

```bash
xtools follow user USERNAME
```

### `xtools follow by-keyword`

Follow users tweeting about keywords.

```bash
xtools follow by-keyword KEYWORDS... [OPTIONS]

Arguments:
  KEYWORDS    Keywords to search (space-separated)

Options:
  -m, --max INT            Max follows (default: 50)
  --min-followers INT      Min followers filter (default: 100)
  --max-followers INT      Max followers filter (default: 100000)
```

**Examples:**

```bash
xtools follow by-keyword Python "machine learning" -m 25
xtools follow by-keyword coding --min-followers 500
```

### `xtools follow by-hashtag`

Follow users using specific hashtags.

```bash
xtools follow by-hashtag HASHTAGS... [OPTIONS]

Arguments:
  HASHTAGS    Hashtags (without #)

Options:
  -m, --max INT    Max follows (default: 50)
```

### `xtools follow followers-of`

Follow followers of a target account.

```bash
xtools follow followers-of USERNAME [OPTIONS]

Arguments:
  USERNAME    Target account

Options:
  -m, --max INT    Max follows (default: 50)
  --mode TEXT      followers or following (default: followers)
```

**Examples:**

```bash
xtools follow followers-of python -m 30
xtools follow followers-of competitor --mode following
```

### `xtools follow engagers`

Follow users who engaged with specific tweets.

```bash
xtools follow engagers URLS... [OPTIONS]

Arguments:
  URLS    Tweet URLs

Options:
  -m, --max INT       Max follows (default: 50)
  --type TEXT         likers, retweeters, commenters, all (default: likers)
```

---

## Engagement Commands

### `xtools engage like`

Like a specific tweet.

```bash
xtools engage like URL
```

### `xtools engage auto-like`

Auto-like tweets by criteria.

```bash
xtools engage auto-like [OPTIONS]

Options:
  -k, --keyword TEXT      Keywords to match (can repeat)
  -h, --hashtag TEXT      Hashtags to match (can repeat)
  -m, --max INT           Max likes (default: 50)
  -d, --duration INT      Duration in minutes (default: 30)
```

**Examples:**

```bash
xtools engage auto-like -k Python -k coding -m 25
xtools engage auto-like -h 100DaysOfCode --duration 15
```

### `xtools engage comment`

Post a comment on a tweet.

```bash
xtools engage comment URL TEXT
```

### `xtools engage bookmark`

Bookmark a tweet.

```bash
xtools engage bookmark URL
```

### `xtools engage export-bookmarks`

Export all bookmarks.

```bash
xtools engage export-bookmarks [OPTIONS]

Options:
  -o, --output PATH    Output file (default: bookmarks.json)
  --format TEXT        json or csv
```

---

## Monitoring Commands

### `xtools monitor unfollowers`

Detect who unfollowed you.

```bash
xtools monitor unfollowers [OPTIONS]

Options:
  --notify             Send notification
  -o, --output PATH    Export report
```

**Examples:**

```bash
xtools monitor unfollowers
xtools monitor unfollowers --notify -o report.json
```

### `xtools monitor account`

Monitor changes to an account.

```bash
xtools monitor account USERNAME [OPTIONS]

Arguments:
  USERNAME    Account to monitor

Options:
  --since INT    Hours to look back (default: 24)
```

### `xtools monitor keywords`

Monitor X for keywords in real-time.

```bash
xtools monitor keywords KEYWORDS... [OPTIONS]

Arguments:
  KEYWORDS    Keywords to monitor

Options:
  --interval INT    Check interval in seconds (default: 60)
  --notify          Send notifications on match
```

---

## Analytics Commands

### `xtools analytics growth`

Show growth statistics.

```bash
xtools analytics growth [OPTIONS]

Options:
  --days INT    Days of history (default: 30)
```

### `xtools analytics engagement`

Analyze engagement on your tweets.

```bash
xtools analytics engagement [OPTIONS]

Options:
  --limit INT    Tweets to analyze (default: 100)
```

### `xtools analytics best-time`

Find optimal posting times.

```bash
xtools analytics best-time [OPTIONS]

Options:
  --limit INT    Tweets to analyze (default: 200)
```

---

## AI Commands

### `xtools ai reply`

Generate an AI reply.

```bash
xtools ai reply TEXT [OPTIONS]

Arguments:
  TEXT    Tweet text to reply to

Options:
  --style TEXT      Reply style (default: helpful)
  --provider TEXT   openai, anthropic, ollama
```

**Examples:**

```bash
xtools ai reply "Just launched my startup!" --style supportive
xtools ai reply "Python vs JavaScript?" --style witty
```

### `xtools ai sentiment`

Analyze sentiment of text.

```bash
xtools ai sentiment TEXT
```

### `xtools ai detect-bot`

Analyze if an account is a bot.

```bash
xtools ai detect-bot USERNAME
```

---

## Configuration Commands

### `xtools config show`

Show current configuration.

```bash
xtools config show
```

### `xtools config set`

Set a configuration value.

```bash
xtools config set KEY VALUE
```

**Examples:**

```bash
xtools config set headless true
xtools config set rate_limit.delay 5
```

---

## Output Formats

All scraping commands support these output formats:

| Format | Extension | Description |
|--------|-----------|-------------|
| JSON | `.json` | Structured data |
| CSV | `.csv` | Spreadsheet compatible |

**Auto-detection:** Output format is detected from file extension.

```bash
xtools scrape followers python -o followers.json  # JSON
xtools scrape followers python -o followers.csv   # CSV
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication error |
| 3 | Rate limit error |
| 4 | Not found error |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XTOOLS_AUTH_TOKEN` | X/Twitter auth token |
| `XTOOLS_CONFIG` | Config file path |
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `ANTHROPIC_API_KEY` | Anthropic API key |

---

## Cron Examples

```bash
# Daily unfollower check at 9 AM
0 9 * * * xtools monitor unfollowers --notify

# Weekly cleanup on Sundays
0 20 * * 0 xtools unfollow non-followers --max 50

# Hourly engagement
0 * * * * xtools engage auto-like -k Python --max 10 --duration 5
```

---

<p align="center">
  <strong>Need help? Run `xtools --help`</strong>
</p>
