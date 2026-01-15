# 🚀 Quick Reference - IndexedDB API

## Basic Usage

### Initialize App
```javascript
// Initialization (automatic pada page load)
await app.init();
```

### Add New Entry
```javascript
const newEntry = {
    id: Date.now().toString(),
    date: '2026-01-15',
    type: 'saham',
    title: 'Beli BBCA',
    reason: 'Fundamental bagus, PE ratio rendah',
    highlight: false,
    pinned: false,
    image: null, // atau base64 string
    timestamp: Date.now()
};

app.data.unshift(newEntry);
await app.saveData();
```

### Get All Entries
```javascript
const allEntries = await app.db.getAll();
console.log(allEntries);
```

### Filter Entries
```javascript
// By category
const sahamEntries = app.data.filter(e => e.type === 'saham');

// By date range
const filtered = app.getFilteredData(); // Uses current UI filters

// Highlighted only
const important = app.data.filter(e => e.highlight);

// Pinned only
const pinned = app.data.filter(e => e.pinned);
```

### Delete Entry
```javascript
const id = '1234567890';
await app.db.delete(id);
app.data = app.data.filter(e => e.id !== id);
app.renderList();
```

### Clear All Data
```javascript
await app.db.clear();
app.data = [];
app.renderList();
```

### Get Storage Stats
```javascript
const stats = await app.db.getStorageEstimate();
console.log(`Used: ${stats.usageInMB} MB`);
console.log(`Total: ${stats.quotaInMB} MB`);
console.log(`Percent: ${stats.percentUsed}%`);
console.log(`Available: ${stats.quotaInMB - stats.usageInMB} MB`);
```

## Console Commands

### Check Current Data
```javascript
// In browser console
console.table(app.data);
```

### Manual Migration Test
```javascript
// Reset IndexedDB
indexedDB.deleteDatabase('JournalFinanceDB');

// Add sample localStorage data
localStorage.setItem('journalFinanceData', JSON.stringify([
  { id: '1', date: '2026-01-15', type: 'saham', title: 'Test', reason: 'Testing', highlight: false, pinned: false, image: null, timestamp: Date.now() }
]));

// Reload page to trigger migration
location.reload();
```

### Force Reload from IndexedDB
```javascript
app.data = await app.db.getAll();
app.renderList();
```

### Export Data (Programmatically)
```javascript
const dataStr = JSON.stringify(app.data, null, 2);
const blob = new Blob([dataStr], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `export_${Date.now()}.json`;
a.click();
URL.revokeObjectURL(url);
```

### Import Data (Programmatically)
```javascript
const jsonData = [...]; // Your data array
app.data = jsonData;
await app.db.saveAll(app.data);
app.renderList();
console.log('Import complete!');
```

## Database Operations

### Direct IndexedDB Access
```javascript
// Get database instance
const db = app.db.db;

// Manual query with index
const transaction = db.transaction(['entries'], 'readonly');
const store = transaction.objectStore('entries');
const index = store.index('date');

// Get all entries from specific date
const request = index.getAll('2026-01-15');
request.onsuccess = () => {
  console.log(request.result);
};
```

### Batch Operations
```javascript
// Add multiple entries efficiently
const entries = [
  { id: '1', date: '2026-01-15', type: 'saham', title: 'Entry 1', ... },
  { id: '2', date: '2026-01-15', type: 'kripto', title: 'Entry 2', ... },
  // ... more entries
];

await app.db.saveAll(entries);
```

## Utilities

### Check Browser Support
```javascript
if (!window.indexedDB) {
  alert('Browser tidak support IndexedDB!');
} else {
  console.log('✅ IndexedDB supported');
}
```

### Estimate Entry Size
```javascript
function estimateSize(entry) {
  const str = JSON.stringify(entry);
  const bytes = new Blob([str]).size;
  return {
    bytes: bytes,
    kb: (bytes / 1024).toFixed(2),
    mb: (bytes / (1024 * 1024)).toFixed(2)
  };
}

// Usage
const entry = app.data[0];
console.log(estimateSize(entry));
```

### Image Size Calculator
```javascript
function getImageSize(base64String) {
  if (!base64String) return 0;
  const stringLength = base64String.length - 'data:image/jpeg;base64,'.length;
  const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383812;
  return {
    bytes: sizeInBytes,
    kb: (sizeInBytes / 1024).toFixed(2),
    mb: (sizeInBytes / (1024 * 1024)).toFixed(2)
  };
}

// Usage
const imgSize = getImageSize(app.data[0].image);
console.log(`Image size: ${imgSize.kb} KB`);
```

## Debugging

### Enable Verbose Logging
```javascript
// Add to console to see all DB operations
app.db.verbose = true;
```

### Check Database State
```javascript
// List all databases
indexedDB.databases().then(dbs => {
  console.log('All databases:', dbs);
});

// Check if our DB exists
indexedDB.databases().then(dbs => {
  const exists = dbs.some(db => db.name === 'JournalFinanceDB');
  console.log('JournalFinanceDB exists:', exists);
});
```

### View IndexedDB in DevTools
1. Open DevTools (F12)
2. Go to **Application** tab
3. Expand **Storage** → **IndexedDB**
4. Click **JournalFinanceDB** → **entries**
5. View all stored data

### Performance Profiling
```javascript
console.time('Load Data');
const data = await app.db.getAll();
console.timeEnd('Load Data');

console.time('Save Data');
await app.db.saveAll(app.data);
console.timeEnd('Save Data');
```

## Common Patterns

### Add with Image
```javascript
async function addEntryWithImage(title, imageFile) {
  const imageData = await app.processImage(imageFile);
  const entry = {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    type: 'saham',
    title: title,
    reason: '',
    highlight: false,
    pinned: false,
    image: imageData,
    timestamp: Date.now()
  };
  
  app.data.unshift(entry);
  await app.saveData();
}
```

### Bulk Import from CSV
```javascript
async function importFromCSV(csvText) {
  const lines = csvText.split('\n');
  const entries = [];
  
  for (let i = 1; i < lines.length; i++) {
    const [date, type, title, reason] = lines[i].split(',');
    if (!date || !title) continue;
    
    entries.push({
      id: Date.now().toString() + i,
      date: date.trim(),
      type: type.trim(),
      title: title.trim(),
      reason: reason?.trim() || '',
      highlight: false,
      pinned: false,
      image: null,
      timestamp: Date.now()
    });
  }
  
  app.data = [...entries, ...app.data];
  await app.saveData();
  console.log(`Imported ${entries.length} entries`);
}
```

### Search with Highlight
```javascript
function searchAndHighlight(keyword) {
  const matches = app.data.filter(e => 
    e.title.toLowerCase().includes(keyword.toLowerCase()) ||
    e.reason.toLowerCase().includes(keyword.toLowerCase())
  );
  
  // Highlight all matches
  matches.forEach(async entry => {
    entry.highlight = true;
    await app.db.save(entry);
  });
  
  app.renderList();
  return matches.length;
}
```

## Error Handling

### Safe Database Operations
```javascript
async function safeDBOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    console.error('DB Error:', error);
    app.showToast('❌ Database error: ' + error.message);
    return null;
  }
}

// Usage
await safeDBOperation(() => app.db.saveAll(app.data));
```

### Fallback to localStorage
```javascript
async function saveWithFallback() {
  try {
    await app.db.saveAll(app.data);
  } catch (e) {
    console.warn('IndexedDB failed, using localStorage');
    localStorage.setItem('journalFinanceData', JSON.stringify(app.data));
  }
}
```

## Tips & Best Practices

### ✅ DO
- Always `await` async DB operations
- Check storage stats regularly
- Backup before major operations
- Use indexes for frequent queries
- Batch operations when possible

### ❌ DON'T
- Don't block UI with sync operations
- Don't store huge uncompressed images
- Don't delete IndexedDB manually (use app.db.clear())
- Don't mix localStorage and IndexedDB writes
- Don't forget error handling

## Keyboard Shortcuts (Dev Mode)

Add these to your app for quick testing:

```javascript
// Add to bottom of script section
if (location.hostname === 'localhost') {
  window.addEventListener('keydown', async (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch(e.key) {
        case 's': // Ctrl+S: Quick save
          e.preventDefault();
          await app.saveData();
          console.log('💾 Saved');
          break;
        case 'i': // Ctrl+I: Show storage info
          e.preventDefault();
          await app.logStorageStats();
          break;
        case 'l': // Ctrl+L: Log data
          e.preventDefault();
          console.table(app.data);
          break;
      }
    }
  });
}
```

---

**Need Help?**
- Check `INDEXEDDB_MIGRATION.md` for detailed docs
- Check `TESTING_GUIDE.md` for test scenarios
- Open DevTools Console for real-time logs
