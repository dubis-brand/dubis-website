const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

registerFont('C:\\Windows\\Fonts\\impact.ttf', { family: 'Impact' });

const c = createCanvas(1024, 1024);
const x = c.getContext('2d');

// Background
x.fillStyle = '#f5f0eb';
x.fillRect(0, 0, 1024, 1024);

// DUBIS text
x.fillStyle = '#1a1a1a';
x.font = 'bold 280px Impact';
x.textAlign = 'center';
x.textBaseline = 'middle';
x.fillText('DUBIS', 512, 460);

// TM
x.font = '40px Impact';
x.fillText('™', 780, 330);

// Gold line
x.fillStyle = '#c8a96e';
x.fillRect(200, 570, 624, 3);

// Tagline
x.fillStyle = '#555555';
x.font = '38px Impact';
x.fillText('FOR THE REST OF US', 512, 630);

const out = path.resolve(__dirname, '..', 'dubis-icon-1024.png');
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('Icon saved to', out);
