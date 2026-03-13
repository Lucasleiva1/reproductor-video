const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'tutorial_source.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const images = ['tip.png', 'trimming.png', 'attribution.png'];

images.forEach(imgName => {
    const imgPath = path.join(__dirname, 'temp_assets', imgName);
    if (fs.existsSync(imgPath)) {
        const base64 = fs.readFileSync(imgPath).toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        // replace src="temp_assets/tip.png" or src="/temp_assets/tip.png"
        const regex = new RegExp(`src=["'][./]*temp_assets/${imgName}["']`, 'g');
        html = html.replace(regex, `src="${dataUrl}"`);
    } else {
        console.log("Missing image:", imgName);
    }
});

// Add animations CSS if not present
if (!html.includes('@keyframes fadeInUp')) {
    const animationCSS = `
        /* Custom Animations */
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlow {
            0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
            100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
        
        .page {
            animation: fadeInUp 0.8s ease-out forwards;
        }
        
        .feature-card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            border-color: var(--primary);
        }

        .screenshot-box {
            transition: transform 0.4s ease;
        }
        .screenshot-box:hover {
            transform: scale(1.02);
        }

        .tip-banner {
            animation: pulseGlow 3s infinite;
        }
    </style>
`;
    html = html.replace('</style>', animationCSS);
}

fs.writeFileSync(htmlPath, html);
console.log('Embedded images and CSS animations successfully.');
