# MCP Setup Guide — Connecting WordPress & GSC to Claude Code

## What is MCP? (Plain English)
MCP (Model Context Protocol) is like a "plugin" that lets Claude Code talk directly 
to your WordPress website and Google Search Console. Instead of you copying and pasting 
data, Claude can read and write to these platforms automatically.

---

## Prerequisites

Before starting, you need:
- [ ] Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- [ ] Node.js installed (version 18 or higher)
- [ ] WordPress website with admin access
- [ ] Google Search Console account with your site verified
- [ ] Text editor (VS Code, Notepad++, or similar)

---

## Step 1: WordPress Application Password

This is how Claude Code authenticates with your WordPress site without using your main password.

```
1. Log into WordPress Admin
2. Go to: Users → Your Profile (or Users → All Users → click your username)
3. Scroll down to: "Application Passwords" section
4. Application Name: Type "Claude Code SEO"
5. Click "Add New Application Password"
6. COPY the password shown (you won't see it again!)
   Format will look like: xxxx xxxx xxxx xxxx xxxx xxxx
7. Remove the spaces when you use it: xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 2: Google Search Console API Setup

```
1. Go to: https://console.cloud.google.com/
2. Create a new project (click "Select a project" → "New Project")
   Name it: "Claude SEO Tool"
3. Enable the Search Console API:
   - In search bar, type "Search Console API"
   - Click on it → Click "Enable"
4. Create credentials:
   - Go to: APIs & Services → Credentials
   - Click: "+ Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: "Desktop app"
   - Name: "Claude SEO"
   - Click Create
   - Download the JSON file → Save as "gsc-credentials.json"
5. Add your Google account as a test user:
   - APIs & Services → OAuth consent screen → Test users → Add your Gmail
```

---

## Step 3: Claude Code Configuration File

Create this file at: `~/.claude/claude_desktop_config.json`

**On Mac:** `/Users/YourName/.claude/claude_desktop_config.json`  
**On Windows:** `C:\Users\YourName\.claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-server-wordpress"],
      "env": {
        "WORDPRESS_SITE_URL": "https://yoursite.com",
        "WORDPRESS_USERNAME": "your-wordpress-username",
        "WORDPRESS_APP_PASSWORD": "yourpasswordwithoutspaces"
      }
    },
    "google-search-console": {
      "command": "npx",
      "args": ["-y", "@ahonn/mcp-google-search-console"],
      "env": {
        "GSC_SITE_URL": "https://yoursite.com/",
        "GOOGLE_CREDENTIALS_PATH": "/path/to/your/gsc-credentials.json"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/your/project"]
    }
  }
}
```

**Replace these values:**
- `https://yoursite.com` → Your actual website URL
- `your-wordpress-username` → Your WordPress login username
- `yourpasswordwithoutspaces` → The application password from Step 1
- `/path/to/your/gsc-credentials.json` → Full path to the file you downloaded in Step 2

---

## Step 4: Verify Connection

Open Terminal/Command Prompt and run:
```bash
claude
```

Then type:
```
Test my WordPress connection by listing the 5 most recent posts on my site
```

If it works, Claude will list your posts. If not, check:
1. Is the site URL exactly right? (Include https://, no trailing slash issues)
2. Is the username correct? (Not your email, your WordPress username)
3. Is the app password copied correctly? (No spaces)

---

## Step 5: First SEO Session

Once connected, start with this message to Claude Code:

```
You are my SEO specialist. You have access to my WordPress site and Google Search Console via MCP.

Please start by:
1. Listing all my WordPress pages and posts (title, URL, status)
2. Pulling the last 90 days of GSC performance data
3. Identifying my top 10 performing pages and top 10 queries
4. Identifying my 5 biggest SEO opportunities

Then present a plain-English summary of what you found and ask me how I'd like to proceed.

My website is: [yoursite.com]
My business type is: [e.g. local plumbing company in Austin TX]
My main goal is: [e.g. more phone calls from local customers]
```

---

## Troubleshooting Common Issues

### "Cannot connect to WordPress"
```
Check 1: Is WordPress REST API enabled? 
  Visit: yoursite.com/wp-json/wp/v2/posts (should show JSON data, not 404)
Check 2: Is there a security plugin blocking REST API?
  Common culprits: Wordfence, iThemes Security
  Fix: Add exception for REST API in security plugin settings
Check 3: Is the URL in config file exactly right?
  Must include https:// and no trailing slash
```

### "GSC authentication failed"
```
Check 1: Did you add your Google account as a test user in Step 2?
Check 2: Is the path to credentials.json correct and absolute?
  Mac: /Users/YourName/Documents/gsc-credentials.json
  Windows: C:\\Users\\YourName\\Documents\\gsc-credentials.json (double backslashes)
Check 3: Run the OAuth flow once to generate a token file
```

### "WordPress app password not working"
```
Check 1: Are there spaces in the password? Remove them.
Check 2: Does your WordPress installation support Application Passwords?
  Requires WordPress 5.6+ and HTTPS
Check 3: Are Application Passwords enabled?
  Some security plugins disable this feature
  Check: Wordfence → Login Security → Application Passwords
```

---

## Alternative: Manual Data Import (No MCP)

If MCP setup is too complex, use this workflow instead:

```
WordPress Data:
1. Install "WP All Export" plugin (free version)
2. Export: All posts + pages with SEO meta (Yoast/RankMath fields)
3. Download CSV → Upload to Claude Code session

GSC Data:
1. GSC → Performance → Export → Google Sheets or CSV
2. Export: Last 90 days, show queries AND pages
3. Upload to Claude Code session

Then tell Claude:
"I've uploaded my WordPress content export and GSC data. 
Please analyze them and act as my SEO specialist."
```

---

## Security Notes

```
⚠️ IMPORTANT SECURITY PRACTICES:

1. Never share your config file publicly (it contains your credentials)
2. Application passwords can be revoked: WordPress Admin → Users → Profile → 
   Application Passwords → Revoke
3. Use environment variables instead of hardcoding credentials when possible
4. The GSC credentials.json file should be stored securely, not in a public folder
5. Regularly rotate application passwords (every 6-12 months)
```
