import fs from 'fs';
import path from 'path';

console.log('🔍 INITIATING DEEP CODE, FEATURE & VULNERABILITY AUDIT SCAN...');

const ROOT_DIR = process.cwd();
const filesToScan = [
    'backend/worker.js',
    'public/app.js',
    'public/auth.js',
    'public/OptimizedDB.js',
    'public/ConnectionMonitor.js',
    'public/sw.js',
    'public/index.html'
];

const results = {
    features: [],
    vulnChecks: [],
    codeQuality: [],
    stats: {
        filesScanned: 0,
        totalLines: 0,
        issuesFound: 0
    }
};

for (const relPath of filesToScan) {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    results.stats.filesScanned++;
    results.stats.totalLines += lines.length;

    // --- 1. HARDCODED SECRETS SCAN ---
    const secretRegexes = [
        { name: 'Hardcoded JWT Secret', regex: /jwt_secret\s*[:=]\s*['"`][a-zA-Z0-9_\-]{8,}['"`]/i },
        { name: 'Hardcoded Cloudflare/AWS API Key', regex: /(?:cf_|aws_|api_)key\s*[:=]\s*['"`][a-zA-Z0-9_\-]{16,}['"`]/i },
        { name: 'Hardcoded Private Key', regex: /-----BEGIN PRIVATE KEY-----/ }
    ];

    for (const rule of secretRegexes) {
        if (rule.regex.test(content)) {
            results.vulnChecks.push({
                file: relPath,
                type: 'SECRET_LEAK',
                severity: 'HIGH',
                detail: `Found potential ${rule.name}`
            });
        }
    }

    // --- 2. SQL INJECTION AUDIT (backend/worker.js) ---
    if (relPath.includes('worker.js')) {
        const prepareLines = lines.filter(l => l.includes('.prepare('));
        for (const line of prepareLines) {
            // Check if string concatenation or template literals are used inside prepare
            if (line.includes('.prepare(`') && line.includes('${')) {
                results.vulnChecks.push({
                    file: relPath,
                    type: 'SQLI_RISK',
                    severity: 'CRITICAL',
                    detail: `Template literal in db.prepare: ${line.trim()}`
                });
            }
        }
    }

    // --- 3. D1 BOLA/IDOR CHECK (worker.js) ---
    if (relPath.includes('worker.js')) {
        // Find queries touching entries without user_id
        const entryQueryRegex = /SELECT\s+.*?\s+FROM\s+entries(?!\s+WHERE.*user_id)/i;
        if (entryQueryRegex.test(content)) {
            // Check if it's admin or intentional
            results.vulnChecks.push({
                file: relPath,
                type: 'IDOR_RISK',
                severity: 'HIGH',
                detail: 'Potential query on `entries` table without user_id constraint'
            });
        }
    }

    // --- 4. XSS SCAN (public/app.js) ---
    if (relPath.includes('app.js')) {
        lines.forEach((line, idx) => {
            if (line.includes('.innerHTML =') && !line.includes('escapeHtml') && !line.includes('sanitizeHtml')) {
                // Check if it contains dynamic variables
                if (line.includes('${') || line.includes(' + ')) {
                    results.vulnChecks.push({
                        file: `${relPath}:${idx + 1}`,
                        type: 'XSS_INSPECTION',
                        severity: 'MEDIUM',
                        detail: `Direct innerHTML assignment: ${line.trim().slice(0, 100)}`
                    });
                }
            }
        });
    }

    // --- 5. CSPRNG AUDIT ---
    if (relPath.includes('worker.js') || relPath.includes('auth.js')) {
        lines.forEach((line, idx) => {
            if (line.includes('Math.random()') && (line.includes('token') || line.includes('salt') || line.includes('secret') || line.includes('id'))) {
                results.vulnChecks.push({
                    file: `${relPath}:${idx + 1}`,
                    type: 'WEAK_RANDOM',
                    severity: 'MEDIUM',
                    detail: `Insecure Math.random() in security-sensitive context: ${line.trim()}`
                });
            }
        });
    }
}

// --- FEATURE INVENTORY EXTRACTION ---
const workerContent = fs.readFileSync(path.join(ROOT_DIR, 'backend/worker.js'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT_DIR, 'public/app.js'), 'utf8');

// Match endpoints in worker.js
const routeMatches = [...workerContent.matchAll(/url\.pathname(?:\s*===|\.startsWith|\.match)\s*\((?:['"`]([^'"`]+)['"`]|\/([^\/]+)\/)/g)];
const endpoints = new Set();
for (const match of routeMatches) {
    if (match[1]) endpoints.add(match[1]);
}

// Match features in app.js
const uiFeatures = [];
if (appContent.includes('ReceiptScanner') || appContent.includes('scanReceipt')) uiFeatures.push('Receipt / OCR Scanning');
if (appContent.includes('renderDashboard') || appContent.includes('updateDashboard')) uiFeatures.push('Financial Dashboard & Summary');
if (appContent.includes('exportData') || appContent.includes('importData')) uiFeatures.push('Data Backup, JSON & CSV Export/Import');
if (appContent.includes('category') || appContent.includes('categories')) uiFeatures.push('Category Management & Budget Tracking');
if (appContent.includes('OptimizedDB') || appContent.includes('indexedDB')) uiFeatures.push('Offline-First Architecture (IndexedDB)');
if (appContent.includes('initAdaptiveSync')) uiFeatures.push('Adaptive Background Cloud Sync (ETag 304)');
if (appContent.includes('theme') || appContent.includes('dark-mode')) uiFeatures.push('Theme Switcher (Dark/Light)');
if (appContent.includes('ConnectionMonitor')) uiFeatures.push('Real-time Connection & Telemetry Monitoring');

console.log('\n📊 SCAN COMPLETE.');
console.log(`Total Files: ${results.stats.filesScanned} | Lines of Code: ${results.stats.totalLines}`);
console.log(`Vulnerability / Risk Findings: ${results.vulnChecks.length}`);
console.log('\nDetected Endpoints in API:');
console.log(Array.from(endpoints));
console.log('\nDetected Web App Features:');
console.log(uiFeatures);

if (results.vulnChecks.length > 0) {
    console.log('\n⚠️ Vulnerability Findings:');
    console.log(JSON.stringify(results.vulnChecks, null, 2));
} else {
    console.log('\n✅ 0 Critical or High Vulnerabilities Found in Static Patterns!');
}
