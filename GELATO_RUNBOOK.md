# DUBIS — Gelato Operations Runbook
> תהליכי עבודה עם Gelato | עודכן: מרץ 2026

---

## 1. הוספת מוצר חדש — צ'קליסט חובה

לפני שמוצר חדש יוצא לאוויר ומחובר לגלאטו, יש לעבור על כל הסעיפים:

### קבצי עיצוב
- [ ] **חזית** (`front_logo_white.png` / `front_logo_dark.png`): מינימום **3,600×4,200px**, PNG שקוף, sRGB
- [ ] **גב** (`back_design_{id}_{variant}.png`): מינימום **3,000×3,600px**, PNG שקוף, sRGB
- [ ] **כובע** (`cap_design_{variant}.png`): **1,800×900px** לפחות — לוודא עם Gelato
- [ ] וידוא שהקבצים נגישים בכתובת: `https://www.dubis.net/designs/`
- [ ] בדיקת גודל קובץ: כל קובץ חייב להיות **מעל 200KB** — אחרת Gelato דוחה בשקט

### בדיקת UID
- [ ] `baseUid` בקובץ `products.js` מוגדר ותואם לפורמט Gelato
- [ ] בדיקה בגלאטו: Catalog → Products → חיפוש ה-UID

### בדיקת צבעים
- [ ] כל צבע ב-`colors[]` ממופה ב-`COLOR_MAP` ב-`create-gelato-order.js`
- [ ] `DARK_COLORS` מכיל את כל הצבעים הכהים (Black, Navy, Charcoal, Forest Green)
- [ ] תמונות `images/product-{id}-{Color}-front.jpg` ו-`back.jpg` קיימות לכל צבע

---

## 2. תהליך בדיקה לפני Deploy

```bash
# בדוק שכל קבצי העיצוב נגישים ומספיק גדולים
for file in front_logo_white front_logo_dark; do
  curl -sI "https://www.dubis.net/designs/${file}.png" | grep -E "HTTP|Content-Length"
done
# Content-Length חייב להיות > 200000 (200KB)
```

---

## 3. טיפול בתקלת הדפסה — תהליך סטנדרטי

### סימנים לתקלה
- לקוח דיווח שקיבל עיצוב שגוי / ריק / "J B" במקום DUBIS
- צילום מסך מ-Gelato dashboard מראה עיצוב שגוי

### שלב 1 — זיהוי
1. היכנס ל-Gelato Dashboard → Orders
2. מצא את ההזמנה לפי Order Reference ID (`DUBIS-{PaypalOrderId}`)
3. בדוק את ה-"Print Files" בהזמנה — אלו הקבצים שנשלחו בפועל

### שלב 2 — בדיקת שורש הבעיה
```bash
# בדוק גודל קובץ העיצוב
curl -sI "https://www.dubis.net/designs/front_logo_white.png" | grep Content-Length
# אם < 200000 → זו הבעיה
```

### שלב 3 — תיקון קובץ (אם נדרש)
```python
# generate_fronts_v2.py — כבר קיים במאגר
# מייצר קבצים ב-3600×4200px
python3 generate_fronts_v2.py
# העלה לגלאטו ופרוס ל-Vercel
```

### שלב 4 — פתיחת קריאה בגלאטו
1. Gelato Dashboard → Orders → מצא ההזמנה → **Report Problem**
2. בחר: **Issue with quality** → **Other quality issue**
3. תיאור:
   ```
   Front printed wrong design instead of DUBIS logo.
   Root cause: design file was undersized (below minimum resolution).
   File has been fixed. Request free reprint.
   Size: [XL/L/M] | Color: [Black/Navy/etc]
   ```
4. Desired Solution: **reorder**

> **ציפיה:** Gelato מאשרים reprint בחינם בדרך כלל תוך שעות.

### שלב 5 — תקשורת עם לקוח
**נוסח Email ללקוח:**
```
Subject: עדכון על ההזמנה שלך מ-DUBIS

שלום [שם],
גילינו שההזמנה שלך ([מספר]) לא הודפסה כהלכה.
אנחנו מצטערים על אי הנוחות.
הפקנו הדפסה חדשה והיא בדרך אליך.
זמן משלוח משוער: 7–14 ימי עסקים.
תודה על הסבלנות שלך!
צוות DUBIS 🐾
```

---

## 4. הוספת עיצוב גב חדש

כשמוצר חדש דורש עיצוב גב ייחודי (לא shared עם מוצר אחר):

1. **צור קבצי גב:**
   - `back_design_{productId}_white.png` — לבגדים כהים (Black/Navy/Charcoal/Forest Green)
   - `back_design_{productId}_dark.png` — לבגדים בהירים (White/Cream/etc)
   - גודל: **3,000×3,600px מינימום**, PNG שקוף

2. **העלה לתיקיית designs:**
   ```bash
   cp back_design_X_white.png /path/to/dubis-website/designs/
   cp back_design_X_dark.png  /path/to/dubis-website/designs/
   ```

3. **עדכן `products.js`:**
   - וודא ש-`designRef` לא מצביע למוצר אחר בטעות

4. **Deploy ל-Vercel**

---

## 5. מינימום ספציפיקציות קבצים — מדריך מהיר

| אזור | גודל מינימלי | DPI | פורמט | רקע |
|------|-------------|-----|--------|-----|
| חזית | 3,600×4,200px | 300 | PNG | שקוף |
| גב | 3,000×3,600px | 300 | PNG | שקוף |
| כובע | 1,800×900px | 300 | PNG | שקוף |

**כלל ברזל:** קובץ מתחת ל-200KB = בעיה. Gelato דוחה בשקט.

---

## 6. ולידציה אוטומטית בקוד

`create-gelato-order.js` כולל כעת ולידציה אוטומטית לפני כל הזמנה:
- שולח HEAD request לכל קובץ עיצוב
- מוודא HTTP 200 + Content-Length ≥ 200KB
- אם נכשל — **חוסם את ההזמנה ומחזיר שגיאה מפורשת**
- לוג מופיע ב-Vercel Runtime Logs

---

## 7. קישורים חיוניים

| שירות | קישור |
|-------|-------|
| Gelato Dashboard | https://dashboard.gelato.com |
| Gelato Orders | https://dashboard.gelato.com/orders |
| Gelato Catalog | https://dashboard.gelato.com/catalogue |
| Vercel Deployments | https://vercel.com/dubis |
| Supabase DB | https://supabase.com/dashboard |
| GitHub Repo | https://github.com/dubis-brand/dubis-website |

---

*עדכון אחרון: מרץ 2026 | DUBIS Operations*
