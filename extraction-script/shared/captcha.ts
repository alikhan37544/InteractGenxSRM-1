// Shared CAPTCHA / bot-check detection.
//
// Used by the secondary agent after each browser action: when a challenge page
// appears, the agent notifies the user, waits for it to be solved manually, and
// then continues automatically.

export interface CaptchaDetection {
    detected: boolean;
    provider?: string;
    reason?: string;
}

// Strong URL patterns only: a page *about* captchas may legitimately have
// "captcha" in its URL/title, so those bare words are left to text detection.
const CAPTCHA_URL_RE =
    /(recaptcha|hcaptcha|cdn-cgi\/challenge|challenge_platform|sorry\/index|unusual.?traffic|bot.?check|turnstile|verify.?human)/i;

const CAPTCHA_TITLE_RE =
    /(just a moment|attention required|are you a robot|verify (that )?you are (a )?human|security check|bot check|captcha verification|human verification|challenge required)/i;

// Strong phrases that only appear on challenge pages. Checked on the leading
// part of the page so an article *about* CAPTCHAs does not trigger a false
// positive.
const CAPTCHA_TEXT_PATTERNS: Array<{ re: RegExp; provider: string }> = [
    { re: /verify (that )?you are (a )?human/i, provider: 'human-verification' },
    { re: /i'?m not a robot/i, provider: 'recaptcha' },
    { re: /please complete the (following )?(challenge|security check)/i, provider: 'challenge' },
    { re: /unfortunately, bots use duckduckgo too/i, provider: 'duckduckgo-anomaly' },
    { re: /automated queries|unusual traffic from your (computer|network)/i, provider: 'google-sorry' },
    { re: /checking your browser before accessing/i, provider: 'cloudflare' },
    { re: /enable javascript and cookies to continue/i, provider: 'cloudflare' },
    { re: /complete the security check/i, provider: 'security-check' },
    { re: /solve (this )?(puzzle|challenge)/i, provider: 'puzzle' },
    { re: /press (and hold|& hold)/i, provider: 'press-hold' },
    { re: /confirm (this search was made by a human|you are human)/i, provider: 'human-verification' },
];

/**
 * Detect whether the given page looks like a CAPTCHA / bot check.
 */
export function detectCaptcha(input: { url?: string; title?: string; text?: string }): CaptchaDetection {
    const url = input.url || '';
    const title = input.title || '';
    const text = input.text || '';

    if (CAPTCHA_URL_RE.test(url)) {
        return { detected: true, provider: 'url', reason: 'URL matches a known challenge pattern' };
    }
    if (CAPTCHA_TITLE_RE.test(title)) {
        return { detected: true, provider: 'title', reason: `Page title indicates a bot check: "${title.slice(0, 80)}"` };
    }

    const head = text.slice(0, 1500);
    for (const { re, provider } of CAPTCHA_TEXT_PATTERNS) {
        if (re.test(head)) {
            return { detected: true, provider, reason: 'Page shows a bot-check challenge' };
        }
    }

    return { detected: false };
}
