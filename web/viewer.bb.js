'use strict'

function BoundingBoxLayerBuilder(bbLayerDiv, pageIdx) {
  this.bbLayerDiv = bbLayerDiv;
  this.pageIdx = pageIdx;
  this.layoutDone = false;
}

BoundingBoxLayerBuilder.prototype = {
  beginLayout: function() {
    this.bbDivs = [];
  },
  
  endLayout: function() {
    this.layoutDone = true;
    this.insertDivContent();
  },
  
  renderLayer: function() {
  },
  
  appendBoundingBox: function(bb) {
  },
  
  insertDivContent: function() {
  }
};
