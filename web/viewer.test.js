'use strict';

var Test = (function() {
  var assertEquals = Utils.assertEquals;
  function test_Utils_shouldConcatText() {
    var sct = Utils.shouldConcatText.bind(Utils);
    assertEquals(sct("abc", "def", false), false, 'sct("abc", "def", false)');
  }

  var Test = {
    tests: [
      { name: "Utils::shouldConcatText", func: test_Utils_shouldConcatText },
    ],
    run: function() {
      this.tests.forEach(function(test) {
        try {
          test.func();
        } catch (ex) {
          var msg = "Test " + test.name + " failed:\n\t" + ex.toString().split("\n").join("\n\t");
          if (ex.stack)
            msg += "\n\nStack Trace:\n\t" + ex.stack.split("\n").slice(1).join("\n\t");
          console.error(msg);
        }
      });
    }
  };
  return Test;
})();
