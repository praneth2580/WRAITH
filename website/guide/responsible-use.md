# Use responsibly

wraith makes automation polite and natural-looking. It doesn't make it permitted. Before you point it at a site:

- **Read the site's terms of service.** Many forbid automated access, or allow it only through an official API. If there's an API, use it.
- **Keep the rate limit on**, and lower it for small sites. Your scraper shouldn't be noticeable in the site's traffic.
- **Turn on `respectRobotsTxt`** for sites you don't own, and set a `userAgent` that says who you are and how to reach you.
- **Take only what you need**, and cache it rather than fetching the same page again.
- **Be careful with personal data.** Scraping and storing information about people is regulated in many places (GDPR in the EU, DPDP in India, CCPA in California, and others).
- **Don't bypass access controls.** Logging in with your own account to automate your own tasks is one thing; getting into what you aren't allowed to see is another.

## What wraith won't do

wraith doesn't solve CAPTCHAs, send them to solving services, or ask AI models to solve them. A CAPTCHA is a site's explicit signal that it wants a person there, so wraith [hands it to one](/guide/captchas).

Human-like input, proxies and user agents exist so that automation of legitimate tasks is reliable and behaves the way the site's designers expect people to. They aren't tools for evading a site's decision to block automation, and the rate limit applies per site however many proxies or user agents you use. [Avoiding honeypots](/guide/honeypots) keeps your scraper from tripping traps by accident; it doesn't make it welcome where it isn't.
