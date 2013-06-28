"use strict";

(function(d, w) {
  var E = d.getElementById.bind(d);
  w.addEventListener("DOMContentLoaded", function() {
    E("boundingBox").textContent = JSON.stringify(obj.boundingBox);
    E("viewport").textContent = JSON.stringify(obj.viewport);
    E("text").textContent = obj.text;
    E("graphics").textContent = JSON.stringify(obj.graphics);
  }, false);
})(document, window);
