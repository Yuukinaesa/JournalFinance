
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const REQUIRED_FILES = [
    'index.html',
    'app.js',
    'auth.js',
    'worker-db.js',
    'OptimizedDB.js',
    'manifest.json',
    'sw.js'
];

console.log("🔍 Starting Frontend Validation...\n");

let errors = 0;

// 1. Check File Existence
console.log("Checking required files...");
REQUIRED_FILES.forEach(file => {
    const filePath = path.join(PUBLIC_DIR, file);
    if (fs.existsSync(filePath)) {
        console.log(`✅ Found: ${file}`);
    } else {
        console.error(`❌ MISSING: ${file}`);
        errors++;
    }
});

// 2. Syntax Check (Node.js --check)
console.log("\nChecking syntax (via node --check)...");
const JS_FILES = ['app.js', 'auth.js', 'worker-db.js', 'OptimizedDB.js', 'sw.js'];

JS_FILES.forEach(file => {
    try {
        const filePath = path.join(PUBLIC_DIR, file);
        if (fs.existsSync(filePath)) {
            execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
            console.log(`✅ Syntax OK: ${file}`);
        }
    } catch (e) {
        console.error(`❌ Syntax Error in ${file}:`);
        console.error(e.stderr.toString());
        errors++;
    }
});

console.log(`\n🎉 Frontend Validation Completed. Errors: ${errors}`);
if (errors > 0) process.exit(1);
