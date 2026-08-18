var fs = require('fs');
var c = fs.readFileSync('plugins/toonflow_story_multi_character_stage/entry.js', 'utf8');
try {
  new Function(c);
  console.log('OK');
} catch(e) {
  console.log('ERR: ' + e.message);
  var l = c.split('\n');
  for (var i = 0; i < l.length; i++) {
    var sofar = l.slice(0, i+1).join('\n');
    try { new Function(sofar); } catch(e2) {
      console.log('breaks at line ' + (i+1) + ': ' + l[i].slice(0, 100));
      break;
    }
  }
}
