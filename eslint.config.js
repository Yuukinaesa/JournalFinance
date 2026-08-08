export default [
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                // Browser / Web API globals
                window: "readonly",
                document: "readonly",
                localStorage: "readonly",
                navigator: "readonly",
                location: "readonly",
                fetch: "readonly",
                caches: "readonly",
                indexedDB: "readonly",
                self: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                console: "readonly",
                Blob: "readonly",
                File: "readonly",
                URL: "readonly",
                FileReader: "readonly",
                Headers: "readonly",
                Request: "readonly",
                Response: "readonly",
                Image: "readonly",
                atob: "readonly",
                btoa: "readonly",
                crypto: "readonly",
                Uint8Array: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
                Intl: "readonly",
                AbortController: "readonly",

                // Node / Web Worker globals
                globalThis: "readonly",
                process: "readonly",
                module: "readonly",
                importScripts: "readonly",

                // App globals
                Auth: "readonly",
                AuthUI: "readonly",
                ConnectionMonitor: "readonly",
                OptimizedJournalDB: "readonly",
                OptimizedDB: "readonly",
                ConnectionError: "readonly"
            }
        },
        rules: {
            "no-undef": "error",
            "no-redeclare": "error",
            "no-dupe-keys": "error",
            "no-unreachable": "error",
            "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }]
        }
    }
];
