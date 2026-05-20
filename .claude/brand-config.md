# DUBIS — Brand Config for Higgsfield Skills
> מקור התבנית: `סקילים להיגספילד/CLAUDE.md` של נטלי, ממולא ל-DUBIS.
> **הקובץ הזה הוא הקלט הראשי ל-orchestrators** (`higgsfield-reels`, `dubis-design`).
> Brand DNA חי ב-`memory/brand-identity.md` ו-`memory/copy-playbook.md` — זה רק שכבת ה-glue.

---

## על המותג

- **שם העסק:** DUBIS
- **תחום:** Direct-to-consumer fashion (print-on-demand via Gelato)
- **מוצר/שירות עיקרי:** קפוצונים / חולצות / זיפ-הודי / כובעים עם סלוגנים אנגליים — לגברים ונשים 35-55
- **קהל יעד:** IL primary (since 2026-05-17 pivot), US dormant — 35-55, גוף אמיתי, post-kids, non-model, לא יוצאים ב-6 בבוקר ליוגה
- **טון התקשורת:** דוגרי, חבר ציני שראה הכל, אנטי-marketing — לא "סטאנינג", לא "חובה", לא הבטחות. ראה `memory/copy-playbook.md`
- **שפה:** עברית primary (IL pivot, ~70%) + אנגלית (~30% — קהל US הרדום + TikTok international algorithm). שפת הסלוגן על הבגד תמיד EN

## ערכים ועקרונות

- אנחנו רואים אותך — לא דוגמן, לא post-gym, לא קלישאת body-positive
- Zero-apology — לא הומור של חולשה. הומור מתוך עוצמה ומודעות עצמית
- Comfort + Identity — לא "comfort OR style", אלא "both/and"
- אנטי-תרגום — עברית כתוב מאפס, אנגלית כתוב מאפס, שני קופי אחים לא תאומים
- Identity-based CTA — "לשאר המין האנושי: dubis.net", לא "Buy now 20% off"

## סטנדרט ויזואלי — מותגי השראה

> **TODO oren — בחר 5 חשבונות IG שמייצגים את הוויזואל שאנחנו רוצים.** ה-orchestrators יקראו את הרשימה הזו ויבקשו מ-Claude לעגן את הסגנון לפיהן. דוגמאות לקטגוריה (לא רשימה סופית — צריך אישור):

1. **@taylorstitch** — americana lifestyle, אמיתי, lo-fi, אווירה
2. **@everlane** — minimalist, premium, transparent
3. **@_universalstandard** — אמיתי לגוף שאינו דוגמן
4. **@chiarafragoli** (או דומה IL) — מקומי ת"א, שמש, ים, פינג'אן
5. **@maapilim** — IL premium leisure, יבש-מקצועי, חוף

עד שתבחר 5 — orchestrator יפעיל בלי מותגי השראה ויפול חזרה ל-`memory/brand-identity.md` ויזואלי בלבד.

🟡 **רעיון נטלי:** ליצור `dubis-website/images/inspiration-brands/` ולשמור 10-20 תמונות מכל אחת כ-fallback offline.

## פורמטים שאני אוהבת

### Reels (TikTok + IG + FB)
- אורך: **19s** (10s Seedance/Soul Cinema + 3s Ken Burns back + 3s power-word zoom + 3s DUBIS outro)
- aspect: 9:16 1080×1920 30fps
- **voiceover: EN only** (oren directive 2026-05-19) — Brian (gender=men, ElevenLabs v3) או Charlotte (gender=women, v3). אין Dicta Nakdan / HE TTS לוידאו.
- caption: לפי slot.lang (HE או EN, 3-beat formula). הקפשן יכול להיות בעברית אפילו כשהvoiceover באנגלית — נורמלי לטיקטוק IL.
- מבנה קופי: 3-beat (hook → agitation → DUBIS drop). 12-25 מילים.

### פוסטים פיד IG/FB
- 3-5 שורות; אימוג'ים 0-2; האשטגים 5-7
- חייב: קישור `dubis.net/#product-{id}` בקפשן (גלוי, לא רק "link in bio")
- CTA זהותי, לא טרנזקציוני

### Carousels
- 4-7 slides; first slide hook חזק; last slide CTA + product URL
- אופציה: Product showcase across colors, או Slogan deep-dive

### TikTok
- 15-30s אורך
- ניתן להשתמש ב-render-and-publish.js (קיים) או ב-Higgsfield Marketing Studio (חדש)
- Late.io scheduled (קיים)

## נושאים שכדאי לסקר

- חיי 35+ בישראל: פקקים, מרפסת ת"א, ארוחת שישי, חמסין
- "באמת בלי כיוון" — anti-aspirational מעורר חיוך
- בגדים נוחים שאיכפת לאיך הם נראים בלי לשפוט אותך
- "השאר של המין האנושי" — מי שלא ב-Gym 5 פעמים בשבוע
- IL-specific: סופ"ש, יום ראשון 5:55 בבוקר, פינג'אן 03:00, ילדים בחופש

## נושאים שאסור לי לדבר עליהם

- בגדים כפתרון לבעיות גוף ("יוסיף לך ביטחון", "ירזה אותך")
- הבטחות תוצאה ("תרגיש מדהים", "תיראה כמו דוגמן")
- הסתכלות מלמעלה למטה ("בשבילך, מתוקה")
- self-deprecating של חולשה ("אני שמן/שמנה ויודע/ת זאת") — הומור מותר רק מתוך עוצמה
- "must-have" / "stunning" / "perfect" / "מושלם" / "לייף סטייל" — blacklist

## כלים זמינים בפרויקט הזה

- **`.claude/skills/higgsfield-generate/`** — שער ל-30+ מודלים (Seedance 2.0, Soul Cinema, GPT Image 2, Nano Banana 2, brain_activity לQA)
- **`.claude/skills/higgsfield-soul-id/`** — אימון פרסונות עקביות (10 פרסונות IL: men-1..5, women-1..5)
- **`.claude/skills/higgsfield-product-photoshoot/`** — virtual_model_tryout + 9 modes נוספים
- **`.claude/skills/photorealistic-ai-images/`** — 8-part framework + 5 golden rules + 7 templates A-G
- **`.claude/skills/higgsfield-reels/`** — orchestrator Reels (קורא לכל הנ"ל)
- **`.claude/skills/dubis-design/`** — orchestrator תמונות UGC (קורא לכל הנ"ל)
- **`.claude/skills/instagram-publish/`** — פרסום ל-IG + FB (Graph API v21, 7s wait)
- **`?type=copy-qa`** Edge Function (Gemini 2.5 Pro + copy-playbook system_instruction)
- **`?type=weekly-marketing-plan`** Edge Function (יום א' 04:00 UTC, 17 משבצות שבועיות)
- **`weekly_marketing_plans`** + **`agent_tasks`** Supabase tables
- **Late.io API** ל-TikTok scheduling

## הוראות עבודה כלליות

1. **לפני כל יצירת תוכן** — orchestrator קורא:
   - `memory/brand-identity.md` (סלוגנים חיים מ-DB)
   - `memory/copy-playbook.md` (3-beat, blacklist, anti-translation)
   - `dubis-website/.claude/brand-config.md` (הקובץ הזה — מותגי השראה + פורמטים)
2. **לכל פוסט שיוצא** — חייב לעבור:
   - `?type=copy-qa` (ציון ≥ 75)
   - Visual QA: Gemini Vision עם copy-playbook (real body, not model, 35+ visible)
   - Product URL מקושר ל-product פעיל ב-`dubis_products`
3. **שמירה** — תמיד דרך:
   - תמונות → `dubis-website/images/personas/{id}/sample-{timestamp}.jpg` + `dubis_images` table INSERT
   - Reels → `dubis-website/videos/il-campaign/FINAL/{HE,EN}/{persona}-{timestamp}.mp4` + Supabase Storage public
4. **אם בספק** — לעצור ולשאול את oren. אבל **לא לבקש אישור** על משימות אוטונומיות שכבר אושרו (post 2026-05-19).

## משימה שבועית קבועה — אוטונומית

**מתי:** יום א' 04:00 UTC (07:00 IL)
**מה:** הרצת `?type=weekly-marketing-plan` (קיים) → 17 משבצות עם persona_id + product_id
**מי מאשר:** **לא oren יותר** (החלטה 2026-05-19). orchestrator יוצא לדרך אוטומטית אחרי שהדוח השבועי נכנס ל-Boss daily report ביום א' בבוקר.
**מה oren רואה:**
- דוח יומי (כל יום 19:30 IL) — "📣 שיווק היום" + "🎬 Reels שיוצרו" + "🎨 תמונות שיוצרו"
- דוח שבועי (יום א' 07:30 IL) — תוכנית 17 המשבצות לשבוע הקרוב + צפי עלויות

## פרסונות

10 פרסונות IL לקמפיין:
- **men-1..5**: גברים ישראלים 38-52, גוף ממוצע, sometimes balding, sometimes stubble
- **women-1..5**: נשים ישראליות 38-52, no makeup, real skin, varied body types

מקור פרטים: `dubis-website/videos/il-campaign/personas-v3.json`
Soul reference IDs: `memory/personas-soul-ids.md` (יתעדכן אחרי Phase 0 training)

## עדכון אחרון

2026-05-19 · מהדורה ראשונה. עדכון הבא כשנטלי שולחת skills פרטיים נוספים (skill ריאליזם + Adobe edit).
