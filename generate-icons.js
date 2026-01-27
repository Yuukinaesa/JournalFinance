/**
 * Icon Generator Script for PWA
 * Generates all required PWA icon sizes from source image
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Source image path - the newly generated icon
const SOURCE_IMAGE = 'C:/Users/arfan/.gemini/antigravity/brain/aa669053-a563-4f7f-bbd2-958a7c425761/journalfinance_icon_1769540332534.png';
const OUTPUT_DIR = './public/icons';

// All required PWA icon sizes
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
    console.log('🎨 Starting icon generation...\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Check if source exists
    if (!fs.existsSync(SOURCE_IMAGE)) {
        console.error('❌ Source image not found:', SOURCE_IMAGE);
        process.exit(1);
    }

    console.log('📁 Source:', SOURCE_IMAGE);
    console.log('📁 Output:', OUTPUT_DIR);
    console.log('');

    for (const size of ICON_SIZES) {
        const outputPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.png`);

        try {
            await sharp(SOURCE_IMAGE)
                .resize(size, size, {
                    fit: 'cover',
                    position: 'center'
                })
                .png({
                    quality: 100,
                    compressionLevel: 9
                })
                .toFile(outputPath);

            console.log(`✅ Generated: icon-${size}x${size}.png`);
        } catch (error) {
            console.error(`❌ Failed: icon-${size}x${size}.png -`, error.message);
        }
    }

    // Also copy the original as a 1024x1024 version for future use
    const originalCopyPath = path.join(OUTPUT_DIR, 'icon-1024x1024.png');
    try {
        await sharp(SOURCE_IMAGE)
            .resize(1024, 1024, {
                fit: 'cover',
                position: 'center'
            })
            .png({ quality: 100 })
            .toFile(originalCopyPath);
        console.log(`✅ Generated: icon-1024x1024.png (master copy)`);
    } catch (error) {
        console.error(`❌ Failed to create master copy:`, error.message);
    }

    // Generate favicon.ico equivalent (32x32 as PNG for modern browsers)
    const faviconPath = path.join('./public', 'favicon.png');
    try {
        await sharp(SOURCE_IMAGE)
            .resize(32, 32, { fit: 'cover', position: 'center' })
            .png({ quality: 100 })
            .toFile(faviconPath);
        console.log(`✅ Generated: favicon.png`);
    } catch (error) {
        console.error(`❌ Failed to create favicon:`, error.message);
    }

    console.log('\n🎉 Icon generation complete!');
}

generateIcons();
