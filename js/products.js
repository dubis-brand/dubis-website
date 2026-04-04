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
        price: 28,
        image: "images/product-1.jpg",
        colors: ["Black", "White", "Cream", "Navy", "Red"],
        sizes: SIZES_TSHIRT,
        description: "Designed for people who enjoy life, love good food, and owe absolutely zero explanations to anyone.",
        description_he: "בשביל מי שנהנה מהחיים, אוהב לאכול טוב, ולא חייב לאף אחד כלום. החולצה שאומרת את זה בשבילך.",
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
        price: 28,
        image: "images/product-2.jpg",
        colors: ["Honey Brown", "Black", "Cream", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "More warmth. More presence. More unapologetic you. For everyone who's tired of taking up less space than they deserve.",
        description_he: "יותר חום. יותר נוכחות. יותר אתה — בלי להתנצל על זה. למי שנמאס לו לקחת פחות מקום ממה שמגיע לו.",
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
        price: 41,
        image: "images/product-3.jpg",
        colors: ["Charcoal", "Cream", "Navy", "Forest Green"],
        sizes: SIZES_HOODIE,
        description: "For those who realized life is too short for the treadmill, but just right for a good nap.",
        description_he: "למי שהבין שהחיים קצרים מדי בשביל הליכון — ומספיק ארוכים בשביל שנ\"צ מכובד. קפוצון רציני לאדם רציני.",
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
        price: 28,
        image: "images/product-4.jpg",
        colors: ["Black", "White", "Charcoal", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "Some days, surviving is the whole damn victory. Wear this when you want the world to know: you showed up. You made it. That's the win.",
        description_he: "יש ימים שלשרוד זה הכל. הגעת, עברת את זה — זה הניצחון. החולצה שמכירה בזה.",
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
        price: 28,
        image: "images/product-5.jpg",
        colors: ["Black", "White", "Cream", "Charcoal", "Honey Brown"],
        sizes: SIZES_TSHIRT,
        description: "You don't need much. But what you bring to the table? Absolutely priceless. This tee gets it.",
        description_he: "לא דורש הרבה. אבל מה שאתה מביא לשולחן? אין תחליף לזה. החולצה מבינה אותך.",
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
        price: 41,
        image: "images/product-6.jpg",
        colors: ["Charcoal", "Black", "Navy", "Honey Brown"],
        sizes: SIZES_HOODIE,
        description: "The ultimate answer to every fitting room that ever made you feel flawed. A flattering fit that demands nothing but you being you.",
        description_he: "התשובה לכל תא מדידה שגרם לך להרגיש לא בסדר. קפוצון שמחמיא לגוף כמו שהוא — ולא מבקש ממך כלום חוץ מלהיות אתה.",
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
        price: 28,
        image: "images/product-cap.jpg",
        colors: ["Charcoal", "Cream", "Honey Brown", "Black", "Navy"],
        sizes: SIZES_CAP,
        description: "A cap for everyone fashion forgot to invite. Consider this your invitation. One size, all bodies, zero pretense.",
        description_he: "כובע לכל מי שהאופנה שכחה להזמין. זו ההזמנה שלך. מידה אחת, כל הגופים, אפס יומרות.",
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
        price: 28,
        image: "images/product-8.jpg",
        designRef: 4,  // placeholder design file
        colors: ["Black", "Charcoal", "Navy", "Red", "Forest Green"],
        sizes: SIZES_TSHIRT,
        description: "You were born for rest. Society had other plans. Wear this every Monday and let the world know where you stand.",
        description_he: "נולדת לנוח. לחברה היו תוכניות אחרות. לבש את זה כל יום שני ותן לעולם לדעת את האמת.",
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
        price: 46,
        image: "images/product-9.jpg",
        designRef: 6,  // placeholder design file
        colors: ["Black", "Navy", "Charcoal"],
        sizes: SIZES_HOODIE,
        description: "Your mind works overtime. Your body deserves the warmup. Zip it up, overthink it later.",
        description_he: "המוח שלך לא מפסיק. הגוף שלך מגיע לנוח בינתיים. סגור את הרוכסן, תחשוב יותר מדי אחר כך.",
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
        price: 31,
        image: "images/product-10.jpg",
        designRef: 3,  // napping theme design
        colors: ["Black", "Navy", "White", "Forest Green"],
        sizes: SIZES_LONGSLEEVE,
        description: "Napping is not a hobby. It's a discipline. It's an art form. This sleeve announces your credentials.",
        description_he: "שנ\"צ זה לא תחביב. זו דיסציפלינה. זו אמנות. השרוול הזה מכריז על הניסיון שלך בתחום.",
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
        price: 28,
        image: "images/product-11.jpg",
        designRef: 3,  // napping theme design
        colors: ["White", "Cream", "Black", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "She believed. She achieved. She celebrated by sleeping. For the woman who earns every minute of her rest.",
        description_he: "היא האמינה, היא עשתה את זה, ואז ישנה. לאישה שמרוויחה כל דקת מנוחה שלה.",
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
        price: 28,
        image: "images/product-12.jpg",
        designRef: 5,  // placeholder design file
        colors: ["Black", "White", "Cream", "Navy"],
        sizes: SIZES_TSHIRT,
        description: "Two essential ingredients for getting through the day with a smile. Or without one. This tee doesn't judge.",
        description_he: "שני המרכיבים הבסיסיים לעבור את היום. עם חיוך או בלי — החולצה לא שופטת.",
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
        price: 41,
        image: "images/product-13.jpg",
        designRef: 6,  // placeholder design file
        colors: ["Charcoal", "Cream", "Navy", "Honey Brown"],
        sizes: SIZES_HOODIE,
        description: "Welcome to the club. Membership requirements: a couch, a blanket, and absolutely no ambition today. We meet daily.",
        description_he: "ברוכה הבאה למועדון. דרישות חברות: ספה, שמיכה, ואפס שאיפות להיום. מתכנסים כל יום.",
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
        price: 31,
        image: "images/product-14.jpg",
        designRef: 5,  // placeholder design file
        colors: ["Cream", "White", "Black", "Navy"],
        sizes: SIZES_LONGSLEEVE,
        description: "It's not laziness — it's loyalty. The most committed relationship in your life. Wear it proudly.",
        description_he: "זה לא עצלות — זו נאמנות. הקשר הכי יציב בחייך. לבשי אותו בגאווה.",
        fabric: "100% combed ring-spun cotton",
        fit: "Women's fitted cut",
        printMethod: "DTG — Direct-to-Garment",
        printAreas: ["Front", "Back"],
        care: CARE_TSHIRT,
        care_he: CARE_TSHIRT_HE,
        sizeGuide: SIZE_GUIDE_LONGSLEEVE
    },
];
