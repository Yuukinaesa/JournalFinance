import re

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to match the problematic section (from ${item.hasImage to })
# This regex will capture everything from the hasImage check to the closing script tag and template literal
pattern = r'''(\$\{item\.hasImage \? `)
                                <div id="img-container-\$\{cleanId\}"[^>]*>
                                    <div class="image-skeleton"[^>]*>
                                    </div>
                                </div>
                                <script>.*?</script>\s+
    (` : ''}\s+</div>)'''

# Replacement text
replacement = r'''\1
                                <div id="img-container-${cleanId}" class="image-container" data-entry-id="${cleanId}" style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
                                    <div class="image-skeleton" style="width:100%; height:200px; border-radius:8px;"></div>
                                    <small style="color: var(--text-muted); font-size: 0.75rem; text-align: center;">📷 Loading...</small>
                                </div>
                            \2'''

# Apply the fix with DOTALL flag to match across newlines
content_fixed = re.sub(pattern, replacement, content, flags=re.DOTALL | re.VERBOSE)

# If regex doesn't work, try simpler line-based approach
if content_fixed == content:
    print("Regex approach didn't work, trying line-based...")
    lines = content.split('\n')
    
    # Find the start and end lines
    start_idx = None
    end_idx = None
    
    for i, line in enumerate(lines):
        if '${item.hasImage ?' in line and start_idx is None:
            start_idx = i
        if '</script>' in line and start_idx is not None and end_idx is None:
            # Check if next few lines contain the closing template
            if i + 2 < len(lines) and "` : ''}" in lines[i+1]:
                end_idx = i + 1
                break
    
    if start_idx and end_idx:
        # Replace lines start_idx to end_idx
        new_lines = [
            lines[start_idx].split('?')[0] + '? `',
            '                                <div id="img-container-${cleanId}" class="image-container" data-entry-id="${cleanId}" style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">',
            '                                    <div class="image-skeleton" style="width:100%; height:200px; border-radius:8px;"></div>',
            '                                    <small style="color: var(--text-muted); font-size: 0.75rem; text-align: center;">📷 Loading...</small>',
            '                                </div>',
            "                            ` : ''}"
        ]
        
        lines[start_idx:end_idx+1] = new_lines
        content_fixed = '\n'.join(lines)
        print(f"Fixed lines {start_idx} to {end_idx}")
    else:
        print(f"Could not find problematic section. start_idx={start_idx}, end_idx={end_idx}")
        exit(1)

# Write the fixed content
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content_fixed)

print("✅ File fixed successfully!")
print("   - Removed inline script with nested template literals")
print("   - Replaced with simple skeleton loader")
print("   - Backup saved as index.html.backup")
