const fs = require('fs');
const path = require('path');

const files = {
    '__INDEX_HTML__': 'index.html',
    '__LOGIN_HTML__': 'login.html',
    '__REGISTER_HTML__': 'register.html',
    '__FORGOT_HTML__': 'forgot-password.html',
    '__APP_JS__': 'app.js',
    '__AUTH_JS__': 'auth.js',
    '__DB_JS__': 'OptimizedDB.js',
    '__MANIFEST__': 'manifest.json',
    '__404_HTML__': '404.html'
};

let workerContent = fs.readFileSync('backend/worker.js', 'utf8');

for (const [placeholder, filename] of Object.entries(files)) {
    console.log(`Embedding ${filename}...`);
    let content = fs.readFileSync(filename, 'utf8');

    // Escape backticks and ${} to prevent template literal errors
    content = content.replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');

    workerContent = workerContent.replace(`\`${placeholder}\``, `\`${content}\``);
}

fs.writeFileSync('backend/worker.js', workerContent);
console.log('Worker build complete!');
