# Orvix Perspectives newsletter: email templates

Two templates for announcing a new article to subscribers:

- `perspectives-newsletter.html`: English
- `perspectives-newsletter-ar.html`: Arabic (right-to-left)

**Before the first Arabic send:** ask a native Arabic speaker to read the Arabic template text (the "view in browser" link, the "also new" label, the button and the footer).

## The normal way: automatic drafts

When an editor **publishes** an article in the blog admin (`/admin/`) for the first time, the website fills these templates with the article (title, summary, cover, link) and creates the emails in Brevo as **drafts**. Nothing is sent automatically.

1. In Brevo, open **Campaigns**. You'll find `Perspectives · <title> (EN) · <date>` and, if the article has Arabic text, the `(AR)` one.
2. Check the recipients: **Perspectives (English)** for EN, **Perspectives (Arabic)** for AR. If a draft has no list yet (Brevo sometimes refuses to attach a brand-new list), choose it.
3. Under **Settings / Tracking**, open tracking and click tracking must be **off**.
4. **Send a test to yourself**, check it on your phone, then **Schedule** or **Send**. The article goes live about a minute after publishing; wait for that before sending.

Sender: **marketing@orvixnet.com** (must stay verified in Brevo → Senders). Subscribers are sorted automatically: the Arabic site's sign-up goes to the Arabic list, the English one to the English list.

The steps below are only for writing an email by hand (for example, for an older article).

## 1. Import a template into Brevo (one time per file)

1. Open the `.html` file in Notepad and copy everything (Ctrl+A, Ctrl+C).
2. In Brevo, go to **Campaigns > Templates > New template**.
3. Choose **Paste your code** (or **Import a template > Paste your HTML**), paste, and save.
4. Name it "Perspectives (EN)" or "Perspectives (AR)".
5. In the template settings, set the sender name to Orvix and the sender email to an orvixnet.com address that is verified in Brevo.

## 2. The slots you fill in for each send

| Slot | What to put in it |
|---|---|
| `{{ params.PREHEADER }}` | The one-line teaser that shows next to the subject in the inbox (hidden in the email itself) |
| `{{ params.INTRO }}` | One short opening sentence, e.g. "We've just published a new piece on Orvix Perspectives." |
| `{{ params.COVER_URL }}` | Full web address of the article's cover image (starts with https://) |
| `{{ params.ARTICLE_TITLE }}` | The article title, exactly as on the website |
| `{{ params.ARTICLE_SUMMARY }}` | One to three sentences about the article |
| `{{ params.ARTICLE_URL }}` | Full web address of the article (the button and the image link here) |
| `{{ params.ALSO_TITLE }}`, `{{ params.ALSO_SUMMARY }}`, `{{ params.ALSO_URL }}` | Optional second, smaller "also new" article. Leave `ALSO_TITLE` empty and the whole block is hidden |

Leave `{{ mirror }}` (view in browser) and `{{ unsubscribe }}` exactly as they are. Brevo fills them in automatically, and the unsubscribe link is required by law.

## 3. Prepare each send (simplest way: type the text straight in)

1. Go to **Campaigns > Create campaign > Email**.
2. Choose the list **Perspectives (English)** (ID 3) for the English email, or **Perspectives (Arabic)** (ID 4) for the Arabic one.
3. Write a subject line.
4. Under design, pick the "Perspectives (EN)" or "(AR)" template.
5. Open the code editor and replace each `{{ params.… }}` slot with your real text or web address. Remove the curly braces too.
   - Image: replace `{{ params.COVER_URL }}` with the image address.
   - The title appears twice: once in the heading and once in `alt="…"` on the image (shown when images are blocked). Replace both.
   - The article address appears three times (image, title, button). Replace all three.
6. No second article? Delete everything from the line `{% if params.ALSO_TITLE %}` down to and including `{% endif %}`. If you do have one, fill in the three `ALSO_…` slots and delete just those two `{% … %}` lines.
7. Arabic or English readers only? Each subscriber's language is saved in the contact field **LANGUAGE** (`en` or `ar`), and their sector, if they picked one, in **SECTOR**. Use a segment on LANGUAGE to send the Arabic email only to Arabic subscribers.
8. In the campaign's **Settings / Tracking**, switch **off** open tracking (and click tracking). The Subscribe page promises readers "no tracking pixels", so this must stay off.
9. Save.

(If your developer later sends the campaign through the Brevo API, the slots can stay as they are and get filled automatically. For normal manual campaigns, use step 5.)

## 4. Send a test to yourself first (every time)

1. In the campaign, click **Send a test**.
2. Enter your own email address and send.
3. Open the test on your phone and on your computer. Check that the image shows, the title and summary are right, the button opens the correct article, and no `{{ ... }}` or `{% ... %}` text is left anywhere.
4. Fix anything wrong, then test again.

## 5. Send

1. Confirm the recipients: **Perspectives (English)** (ID 3) or **Perspectives (Arabic)** (ID 4).
2. Click **Schedule** or **Send now**.

Note: opening the `.html` file directly in a web browser shows the slot names as plain text and a broken image. That is normal. It only looks finished once the slots are filled in.
