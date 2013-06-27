"use strict";

(function(d, w) {
  w.addEventListener("DOMContentLoaded", function() {
    d.getElementById("text").textContent = obj.text;
    d.getElementById("graphics").textContent = JSON.stringify(obj.graphics);
  }, false);
})(document, window);
