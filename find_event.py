var fs = require('fs');
var c = fs.readFileSync('plugins/toonflow_story_multi_character_stage/entry.js', 'utf8');
var idx = c.indexOf('current_event:');
var chunk = c.slice(Math.max(0, idx - 50, idx + 100);
console.log('current_event at byte', idx);
console.log(chunk.slice(0, 300));
