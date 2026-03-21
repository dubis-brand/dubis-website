// DUBIS - Product Catalog
// Collection 01 - For the rest of us 🐾
// gender: 'unisex' | 'men' | 'women'
// imageRef: fallback image product ID (until dedicated mockup is ready)
// designRef: fallback design file product ID (until dedicated design file is ready)

const SIZES_TSHIRT    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_HOODIE    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_LONGSLEEVE = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_CAP       = ['One Size'];

const SIZE_GUIDE_TSHIRT = [
    { size: 'S',   chest: 46, length: 70 },
    { size: 'M',   chest: 51, length: 72 },
    { size: 'L',   chest: 56, length: 74 },
    { size: 'XL',  chest: 61, length: 76 },
    { size: '2XL', chest: 66, length: 78 },
    { size: '3XL', chest: 71, length: 80 },
];

const SIZE_GUIDE_HOODIE = [
    { size: 'S',   chest: 56, length: 67 },
    { size: 'M',   chest: 61, length: 70 },
    { size: 'L',   chest: 66, length: 73 },
    { size: 'XL',  chest: 71, length: 76 },
    { size: '2XL', chest: 76, length: 79 },
    { size: '3XL', chest: 81, length: 82 },
];

const SIZE_GUIDE_LONGSLEEVE = SIZE_GUIDE_TSHIRT;

const CARE_TSHIRT = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_HOODIE = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_TSHIRT_HE = [
    "כביסה קרה במכונה, בפנים החוצה",
    "ייבוש בחום נמוך",
    "אין להלבין",
    "אל תגהץ ישירות על ההדפסה",
    "אין לניקוי יבש"
];

const CARE_HOODIE_HE = CARE_TSHIRT_HE;

const CARE_CAP_HE = [
    "ניקוי ידני בלבד",
    "אין כביסה במכונה",
    "אין לייבש במייבש",
    "עצב מחדש וייבש באוויר"
];

const products = [

    // ─── UNISEX (appear in All, Men, Women) ────────────────────────────────────

    {
        id: 1,
        phrase: "I'm not fat, I'm a limited edition",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "unisex",
        price: 45,
        image: "images/product-1.jpg",
        colors: ["Black", "White", "Cream", "Navy", "Red"],
        sizes: SIZES_TSHIRT,
        description: "Not a problem to be solved. Not a size to be hidden. A limited edition — one of a kind, and completely done apologizing. 100% cotton. Fits real bodies.",
        description_he: "לא בעיה לפתרון. לא מידה שצריך להסתיר. מהדורה מוגבלת — אחד מסוגו, וגמר להתנצל.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 2,
        phrase: "More of me to love",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "unisex",
        price: 45,
        image: "images/product-2.jpg",
        colors: ["Honey Brown", "Black", "Cream", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "More warmth. More presence. More unapologetic you. For everyone who's tired of taking up less space than they deserve.",
        description_he: "יותר חום. יותר נוכחות. יותר אתה, ללא התנצלות. למי שנמאס לו לקחת פחות מקום ממה שמגיע לו.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 3,
        phrase: "Napping is my cardio",
        type: "hoodie",
        typeLabel: "Hoodie",
        gender: "unisex",
        price: 75,
        image: "images/product-3.jpg",
        colors: ["Charcoal", "Cream", "Navy", "Forest Green"],
        sizes: SIZES_HOODIE,
        description: "Cardio is overrated. Rest is a skill. You've perfected it. Heavyweight hoodie — because if you're going to commit to the lifestyle, you might as well dress for it.",
        description_he: "קרדיו זה מוגזם. מנוחה זו מיומנות. אתה שלטת בה. קפוצ'ון כבד — כי אם אתה מחויב לאורח החיים הזה, לפחות תתלבש בהתאם.",
        fabric: "80% cotton, 20% polyester — heavyweight fleece",
        fit: "Unisex, relaxed fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_HOODIE,
        care_he: CARE_HOODIE_HE,
        sizeGuide: SIZE_GUIDE_HOODIE
    },
    {
        id: 4,
        phrase: "I survived. That's enough.",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "unisex",
        price: 45,
        image: "images/product-4.jpg",
        colors: ["Black", "White", "Gray", "Navy", "Charcoal"],
        sizes: SIZES_TSHIRT,
        description: "Some days, surviving is the whole damn victory. Wear this when you want the world to know: you showed up. You made it. That's the win.",
        description_he: "יש ימים שלשרוד זה הניצחון כולו. לבש את זה כשאתה רוצה שהעולם ידע: הגעת. שרדת. זה הניצחון.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 5,
        phrase: "Low maintenance, high value",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "unisex",
        price: 45,
        image: "images/product-5.jpg",
        colors: ["Black", "White", "Cream", "Charcoal", "Honey Brown"],
        sizes: SIZES_TSHIRT,
        description: "You don't need much. But what you bring to the table? Absolutely priceless. This tee gets it.",
        description_he: "אתה לא דורש הרבה. אבל מה שאתה מביא לשולחן? חסר תחליף. החולצה מבינה.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 6,
        phrase: "Not a model. Never wanted to be.",
        type: "hoodie",
        typeLabel: "Hoodie",
        gender: "unisex",
        price: 75,
        image: "images/product-6.jpg",
        colors: ["Charcoal", "Black", "Navy", "Honey Brown"],
        sizes: SIZES_HOODIE,
        description: "Models were never the point. Living is the point. This hoodie is for the people who showed up — every day, without filters, without apology.",
        description_he: "מודלים לא היו הנקודה. החיים הם הנקודה. הקפוצ'ון הזה הוא לאנשים שהגיעו — כל יום, בלי פילטרים, בלי התנצלות.",
        fabric: "80% cotton, 20% polyester — heavyweight fleece",
        fit: "Unisex, relaxed fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_HOODIE,
        care_he: CARE_HOODIE_HE,
        sizeGuide: SIZE_GUIDE_HOODIE
    },
    {
        id: 7,
        phrase: "DUBIS — For the rest of us",
        type: "cap",
        typeLabel: "Cap",
        gender: "unisex",
        price: 35,
        image: "images/product-cap.jpg",
        colors: ["Charcoal", "Cream", "Honey Brown", "Black", "Navy"],
        sizes: SIZES_CAP,
        description: "A cap for everyone fashion forgot to invite. Consider this your invitation. One size, all bodies, zero pretense.",
        description_he: "כובע לכולם שהאופנה שכחה להזמין. זו ההזמנה שלך. מידה אחת, כל הגופים, אפס יומרות.",
        fabric: "100% chino cotton twill, unstructured",
        fit: "One Size, adjustable strap",
        printMethod: "Embroidery",
        printAreas: ["Front"],
        care: [
            "Spot clean only",
            "Do not machine wash",
            "Do not tumble dry",
            "Reshape and air dry"
        ],
        care_he: CARE_CAP_HE,
        sizeGuide: [{ size: 'One Size', note: 'Adjustable strap, fits most head sizes' }]
    },

    // ─── MEN'S EXCLUSIVE ───────────────────────────────────────────────────────

    {
        id: 8,
        phrase: "Born to nap, forced to work",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "men",
        price: 45,
        image: "images/product-8.jpg",
        designRef: 4,  // placeholder design file
        colors: ["Black", "Charcoal", "Navy", "Red", "Forest Green"],
        sizes: SIZES_TSHIRT,
        description: "You were born for rest. Society had other plans. Wear this every Monday and let the world know where you stand.",
        description_he: "נולדת לנוח. לחברה היו תוכניות אחרות. לבש את זה כל יום שני ותן לעולם לדעת איפה אתה עומד.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 9,
        phrase: "Certified overthinker",
        type: "ziphoodie",
        typeLabel: "Zip Hoodie",
        gender: "men",
        price: 80,
        image: "images/product-9.jpg",
        designRef: 6,  // placeholder design file
        colors: ["Black", "Navy", "Charcoal"],
        sizes: SIZES_HOODIE,
        description: "Your mind works overtime. Your body deserves the warmup. Zip it up, overthink it later.",
        description_he: "המוח שלך עובד שעות נוספות. הגוף שלך מגיע להתחמם. סגור את הרוכסן, תחשוב מחדש אחר כך.",
        fabric: "80% cotton, 20% polyester — heavyweight fleece",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_HOODIE,
        care_he: CARE_HOODIE_HE,
        sizeGuide: SIZE_GUIDE_HOODIE
    },
    {
        id: 10,
        phrase: "Serial napper",
        type: "longsleeve",
        typeLabel: "Long-Sleeve",
        gender: "men",
        price: 55,
        image: "images/product-10.jpg",
        designRef: 3,  // napping theme design
        colors: ["Black", "Navy", "White", "Forest Green"],
        sizes: SIZES_LONGSLEEVE,
        description: "Napping is not a hobby. It's a discipline. It's an art form. This sleeve announces your credentials.",
        description_he: "שינה זה לא תחביב. זו דיסציפלינה. זו אמנות. השרוול הארוך הזה מכריז על האישורים שלך.",
        fabric: "100% combed ring-spun cotton",
        fit: "Unisex, regular fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_LONGSLEEVE
    },

    // ─── WOMEN'S EXCLUSIVE ─────────────────────────────────────────────────────

    {
        id: 11,
        phrase: "She believed she could, so she took a nap",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "women",
        price: 45,
        image: "images/product-11.jpg",
        designRef: 3,  // napping theme design
        colors: ["White", "Cream", "Black", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "She believed. She achieved. She celebrated by sleeping. For the woman who earns every minute of her rest.",
        description_he: "היא האמינה. היא הגשימה. היא חגגה בשינה. לאישה שמרוויחה כל דקה של מנוחתה.",
        fabric: "100% combed ring-spun cotton",
        fit: "Women's fitted cut",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 12,
        phrase: "I run on coffee and sarcasm",
        type: "tshirt",
        typeLabel: "T-Shirt",
        gender: "women",
        price: 45,
        image: "images/product-12.jpg",
        designRef: 5,  // placeholder design file
        colors: ["Black", "White", "Cream", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "Two essential ingredients for getting through the day with a smile. Or without one. This tee doesn't judge.",
        description_he: "שני המרכיבים החיוניים ליום עם חיוך. או בלי. החולצה לא שופטת.",
        fabric: "100% combed ring-spun cotton",
        fit: "Women's fitted cut",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_TSHIRT
    },
    {
        id: 13,
        phrase: "Zero Motivation Club",
        type: "hoodie",
        typeLabel: "Hoodie",
        gender: "women",
        price: 75,
        image: "images/product-13.jpg",
        designRef: 6,  // placeholder design file
        colors: ["Charcoal", "Cream", "Navy", "Honey Brown"],
        sizes: SIZES_HOODIE,
        description: "Welcome to the club. Membership requirements: a couch, a blanket, and absolutely no ambition today. We meet daily.",
        description_he: "ברוכה הבאה למועדון. דרישות חברות: ספה, שמיכה, ואפס שאיפות להיום. אנחנו נפגשים יום יום.",
        fabric: "80% cotton, 20% polyester — heavyweight fleece",
        fit: "Women's relaxed fit",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_HOODIE,
        care_he: CARE_HOODIE_HE,
        sizeGuide: SIZE_GUIDE_HOODIE
    },
    {
        id: 14,
        phrase: "Emotionally attached to my couch",
        type: "longsleeve",
        typeLabel: "Long-Sleeve",
        gender: "women",
        price: 55,
        image: "images/product-14.jpg",
        designRef: 5,  // placeholder design file
        colors: ["Cream", "White", "Black", "Navy"],
        sizes: SIZES_LONGSLEEVE,
        description: "It's not laziness — it's loyalty. The most committed relationship in your life. Wear it proudly.",
        description_he: "זה לא עצלות — זו נאמנות. הקשר המחויב ביותר בחייך. לבשי אותו בגאווה.",
        fabric: "100% combed ring-spun cotton",
        fit: "Women's fitted cut",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_LONGSLEEVE
    },
];
