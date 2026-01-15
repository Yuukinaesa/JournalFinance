# 🧪 Testing Guide - IndexedDB Migration

## Quick Test Checklist

### ✅ Test 1: Fresh Install (Pengguna Baru)
1. Buka `JournalFinance.html` di browser
2. **Expected Console Logs**:
   ```
   ✅ IndexedDB opened successfully
   📦 ObjectStore created with indexes
   🔄 Checking localStorage for migration...
   📊 Loaded 0 entries from IndexedDB
   💾 Storage Stats:
      Used: 0.00 MB / XXXX.XX MB (0.00%)
   ```
3. **Expected UI**: Stats bar menampilkan "Catatan: 0, Gambar: 0, Storage: 0.00 MB"

### ✅ Test 2: Migration (Pengguna dengan Data Lama)
1. Simulasi data lama:
   ```javascript
   // Paste di Console
   localStorage.setItem('journalFinanceData', JSON.stringify([
     {
       id: "1737000000000",
       date: "2026-01-15",
       type: "saham",
       title: "Test Entry Migration",
       reason: "Testing migration from localStorage to IndexedDB",
       highlight: false,
       pinned: false,
       image: null,
       timestamp: 1737000000000
     }
   ]));
   ```

2. Refresh halaman (F5)

3. **Expected Console Logs**:
   ```
   🔄 Checking localStorage for migration...
   📦 Migrating 1 entries from localStorage to IndexedDB...
   ✅ Migration complete!
   📊 Loaded 1 entries from IndexedDB
   ```

4. **Expected Toast**: "✅ Migrasi 1 data ke IndexedDB berhasil!"

5. **Expected UI**: Entry muncul di list, stats menampilkan "Catatan: 1"

### ✅ Test 3: Add New Entry with Image
1. Klik FAB (+) button
2. Isi form:
   - Tanggal: Hari ini
   - Kategori: Saham
   - Judul: "Test Foto IndexedDB"
   - Upload gambar (pilih file gambar apa saja)
3. Klik "Simpan"

4. **Expected**:
   - Toast: "Mengoptimalkan gambar..."
   - Toast: "Catatan ditambahkan"
   - Entry muncul dengan gambar
   - Stats updated: "Gambar: 1"
   - Storage usage naik (cek console)

### ✅ Test 4: Storage Statistics
1. Tambah beberapa entry dengan gambar
2. Perhatikan stats bar:
   - **< 50% used**: Icon hijau
   - **50-80% used**: Icon kuning
   - **> 80% used**: Icon merah

3. Check console untuk detailed stats:
   ```
   💾 Storage Stats:
      Used: X.XX MB / XXXX.XX MB (Y.YY%)
      Available: ZZZZ.ZZ MB
   ```

### ✅ Test 5: Backup & Restore
1. **Backup**:
   - Klik tombol "Backup"
   - Download file JSON
   - Expected filename: `journal_finance_backup_2026-01-15.json`

2. **Clear Data (untuk test restore)**:
   ```javascript
   // Di Console
   app.db.clear();
   app.data = [];
   app.renderList();
   ```

3. **Restore**:
   - Klik tombol "Restore"
   - Pilih file backup yang tadi di-download
   - Expected toast: "✅ X data berhasil dipulihkan!"
   - Data muncul kembali

### ✅ Test 6: Performance Check
1. Tambah 50+ entries dengan gambar
2. Test operasi:
   - Filter by category
   - Search by keyword
   - Date range filter
   - Pin/Highlight toggle

3. **Expected**: Semua operasi lancar tanpa freeze/lag

### ✅ Test 7: Browser Compatibility

Test di berbagai browser:
- [ ] Chrome/Edge (Latest)
- [ ] Firefox (Latest)
- [ ] Safari (Latest)
- [ ] Mobile Chrome
- [ ] Mobile Safari

**Check**:
- IndexedDB support
- Storage quota
- Migration success
- UI responsive

## 🐛 Known Issues & Solutions

### Issue 1: Service Worker Error di file://
**Error**: `Failed to register a ServiceWorker`

**Cause**: Service Worker butuh HTTPS atau localhost

**Solution**: Gunakan local server:
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (npx)
npx http-server -p 8000

# Kemudian buka: http://localhost:8000/JournalFinance.html
```

### Issue 2: Private/Incognito Mode
**Error**: "Error loading data"

**Cause**: IndexedDB disabled di private mode (beberapa browser)

**Solution**: Gunakan normal mode

### Issue 3: Storage Quota Exceeded
**Error**: "QuotaExceededError"

**Cause**: Storage penuh (sangat jarang terjadi)

**Solution**:
1. Backup data terlebih dahulu
2. Hapus entries yang tidak perlu
3. Clear browser data (hati-hati!)

## 📊 Performance Benchmarks

### Expected Results:
- **Init time**: < 200ms
- **Add entry**: < 50ms  
- **Load 100 entries**: < 100ms
- **Load 1000 entries**: < 500ms
- **Search/Filter**: < 50ms (instant)

### Memory Usage:
- **Empty**: ~2-5 MB
- **100 entries**: ~5-10 MB
- **100 entries + 50 images**: ~15-30 MB

## 🎯 Success Criteria

Migrasi dianggap berhasil jika:

- [x] IndexedDB opens successfully
- [x] Migration works automatically
- [x] Storage stats displayed correctly
- [x] Add/Edit/Delete operations work
- [x] Backup/Restore compatible
- [x] Images compressed properly
- [x] No data loss
- [x] Performance acceptable
- [x] UI responsive
- [x] Console logs clear and helpful

## 📝 Test Report Template

```
# Test Report - IndexedDB Migration

**Date**: ___________
**Browser**: ___________
**Version**: ___________

## Test Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| Fresh Install | ✅/❌ | |
| Migration | ✅/❌ | |
| Add Entry | ✅/❌ | |
| Add with Image | ✅/❌ | |
| Storage Stats | ✅/❌ | |
| Backup | ✅/❌ | |
| Restore | ✅/❌ | |
| Performance | ✅/❌ | |

## Issues Found
1. ___________
2. ___________

## Recommendations
1. ___________
2. ___________
```

---

**Happy Testing! 🎉**
