"use strict"

var Utils = {
  // Return the position of the topleft corner of the client area relative to 
  // the entire document
  getClientPosition: function(element) {
    if (!element) return { left: 0, top: 0 };
    var bb = element.getBoundingClientRect();
    var left = bb.left + window.pageXOffset;
    var top = bb.top + window.pageYOffset;
    return { left: left, top: top };
  },
  
  // Return the position of pos relative to element2's client area
  // where pos is a position relative to element1's client area
  // Use null for the element to specify position relative to the document
  translatePosition: function(pos, element1, element2) {
    var pos1 = Utils.getClientPosition(element1);
    var pos2 = Utils.getClientPosition(element2);
    return {
      left: pos.left + pos1.left - pos2.left,
      top: pos.top + pos1.top - pos2.top
    };
  }
};
