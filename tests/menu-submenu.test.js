const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, '..', 'main.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('file menu divider actions are grouped under a cascading Dividers submenu', () => {
  assert.match(source, /setTitle\('Dividers'\)/, 'expected one parent Dividers menu item');
  assert.match(source, /setSubmenu/, 'expected Obsidian submenu API usage');
  assert.match(source, /addDividerActionsToMenu/, 'expected shared helper to populate submenu or fallback menu');

  const directDividerItems = [
    "setTitle('Add divider above')",
    "setTitle('Add labeled divider above…')",
    "setTitle('Add divider below')",
    "setTitle('Add labeled divider below…')",
    "setTitle('Remove all dividers')",
  ];

  for (const title of directDividerItems) {
    const directIndex = source.indexOf(title);
    const helperIndex = source.indexOf('addDividerActionsToMenu');
    assert.ok(
      directIndex === -1 || directIndex > helperIndex,
      `${title} should live inside the shared submenu/fallback helper`
    );
  }
});
