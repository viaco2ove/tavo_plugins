var fs = require('fs');
var c = fs.readFileSync('plugins/toonflow_story_multi_character_stage/entry.js', 'utf8');
try {
  new Function(c);
  console.log('OK');
} catch(e) {
  console.log('ERR: ' + e.message);
  // Search for 'div' in strings that might be unquoted
  // Try to find 'div' outside of HTML/tag context
  var inStr = false;
  var strChar = '';
  var lines = c.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    for (var j = 0; j < line.length; j++) {
      var ch = line[j];
      if (!inStr && (ch === '"' || ch === "'" || ch === '`')) {
        inStr = true;
        strChar = ch;
      } else if (inStr && ch === strChar && line[j-1] !== '\\') {
        inStr = false;
      }
    }
    // check for bare div not in string/comment
    if (line.trim().indexOf('div') >= 0 && !inStr) {
      var indent = line.match(/^(\s*)/)[1];
      // Is it inside a string value?
      if (line.indexOf('"') >= 0 && line.indexOf(':') >= 0) {
        console.log('POTENTIAL: line ' + (i+1) + ': ' + line.slice(0,100));
      }
    }
  }
}